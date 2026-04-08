import { getDeviceName, getHashedDeviceId } from "main/lib/device-info";
import { publicProcedure, router } from "../..";

export const createAuthRouter = () => {
	return router({
		getDeviceInfo: publicProcedure.query(() => ({
			deviceId: getHashedDeviceId(),
			deviceName: getDeviceName(),
		})),
	});
};

export type AuthRouter = ReturnType<typeof createAuthRouter>;
