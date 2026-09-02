import { exec } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import { promisify } from "node:util";
import { getProcessTree } from "./port-scanner";

const execAsync = promisify(exec);
const SCAN_INTERVAL_MS = 5000;
const EXEC_TIMEOUT_MS = 3000;

interface DaemonSession {
	pid: number | null;
}

export interface ClaudeChangeEvent {
	paneId: string;
	running: boolean;
}

/**
 * Detects when the `claude` CLI is running within a terminal pane's process tree.
 * Emits `change` events when claude starts or stops running in a pane.
 */
class ClaudeDetector extends EventEmitter {
	private sessions = new Map<string, DaemonSession>();
	private claudeRunning = new Map<string, boolean>();
	private scanInterval: ReturnType<typeof setInterval> | null = null;
	private isScanning = false;

	constructor() {
		super();
		this.startPeriodicScan();
	}

	upsertDaemonSession(paneId: string, pid: number | null): void {
		this.sessions.set(paneId, { pid });
	}

	unregisterDaemonSession(paneId: string): void {
		this.sessions.delete(paneId);
		const wasRunning = this.claudeRunning.get(paneId) ?? false;
		this.claudeRunning.delete(paneId);
		if (wasRunning) {
			this.emit("change", {
				paneId,
				running: false,
			} satisfies ClaudeChangeEvent);
		}
	}

	private startPeriodicScan(): void {
		if (this.scanInterval) return;
		this.scanInterval = setInterval(() => {
			this.scanAllSessions().catch((error) => {
				console.error("[ClaudeDetector] Scan error:", error);
			});
		}, SCAN_INTERVAL_MS);
		this.scanInterval.unref();
	}

	stopPeriodicScan(): void {
		if (this.scanInterval) {
			clearInterval(this.scanInterval);
			this.scanInterval = null;
		}
	}

	private async scanAllSessions(): Promise<void> {
		if (this.isScanning) return;
		if (this.sessions.size === 0) return;
		this.isScanning = true;
		try {
			await Promise.all(
				[...this.sessions.entries()].map(([paneId, session]) =>
					this.scanPane(paneId, session.pid).catch(() => {}),
				),
			);
		} finally {
			this.isScanning = false;
		}
	}

	private async scanPane(paneId: string, pid: number | null): Promise<void> {
		if (!pid) return;
		try {
			const pids = await getProcessTree(pid);
			if (pids.length === 0) return;

			const running = await checkClaudeInPids(pids);
			const previous = this.claudeRunning.get(paneId) ?? false;

			if (running !== previous) {
				this.claudeRunning.set(paneId, running);
				this.emit("change", { paneId, running } satisfies ClaudeChangeEvent);
			}
		} catch {
			// Process may have exited; ignore
		}
	}
}

/**
 * Check if any of the given PIDs is a `claude` process.
 *
 * Uses `ps -p <pids> -o args=` (full command line) so we catch both
 * compiled binaries (comm = "claude") and npm-installed Node.js scripts
 * where comm = "node" but the script path ends in "/claude".
 */
async function checkClaudeInPids(pids: number[]): Promise<boolean> {
	if (pids.length === 0) return false;
	if (os.platform() === "win32") return checkClaudeInPidsWindows(pids);
	try {
		const pidArg = pids.join(",");
		const { stdout } = await execAsync(
			`ps -p ${pidArg} -o args= 2>/dev/null || true`,
			{ timeout: EXEC_TIMEOUT_MS },
		);
		// Match "claude" as a standalone executable or as the last path component
		// before any arguments: e.g. "claude", "/usr/local/bin/claude", "node /path/claude"
		return stdout
			.split("\n")
			.some((line) => /(?:^|[\s/])claude(?:\s|$)/.test(line.trim()));
	} catch {
		return false;
	}
}

async function checkClaudeInPidsWindows(pids: number[]): Promise<boolean> {
	try {
		const pidList = pids.join(",");
		const { stdout } = await execAsync(
			`powershell -NoProfile -Command "Get-Process -Id ${pidList} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name"`,
			{ timeout: EXEC_TIMEOUT_MS },
		);
		return stdout
			.split("\n")
			.some((line) => line.trim().toLowerCase() === "claude");
	} catch {
		return false;
	}
}

export const claudeDetector = new ClaudeDetector();
