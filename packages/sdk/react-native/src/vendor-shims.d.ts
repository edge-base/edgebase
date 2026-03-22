declare module '@cloudflare/realtimekit-react-native' {
  const RealtimeKitMeeting: {
    init(options: {
      authToken: string;
      defaults?: {
        audio?: boolean;
        video?: boolean;
      };
    }): Promise<unknown>;
  };

  export default RealtimeKitMeeting;
}

declare module '@cloudflare/react-native-webrtc' {
  export function registerGlobals(): void;
  export const mediaDevices: {
    getUserMedia?: MediaDevices['getUserMedia'];
    getDisplayMedia?: MediaDevices['getDisplayMedia'];
  };
}
