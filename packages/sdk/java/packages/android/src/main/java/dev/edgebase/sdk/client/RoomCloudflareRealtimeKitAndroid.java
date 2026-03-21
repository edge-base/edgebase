package dev.edgebase.sdk.client;

import android.app.Activity;

import dev.edgebase.sdk.core.RoomClient;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

final class RoomCloudflareRealtimeKitAndroid {
    private static final String DOCS_URL = "https://edgebase.fun/docs/room/media";
    private static volatile boolean installed = false;

    private RoomCloudflareRealtimeKitAndroid() {
    }

    static void maybeRegisterDefaultTransportFactory() {
        if (installed || !isRealtimeKitAvailable()) {
            return;
        }

        synchronized (RoomCloudflareRealtimeKitAndroid.class) {
            if (installed || !isRealtimeKitAvailable()) {
                return;
            }

            RoomClient.setDefaultCloudflareRealtimeKitClientFactory(
                    RoomCloudflareRealtimeKitAndroid::createClientAdapter
            );
            installed = true;
        }
    }

    private static CompletableFuture<RoomClient.RoomCloudflareRealtimeKitClientAdapter> createClientAdapter(
            RoomClient.RoomCloudflareRealtimeKitClientFactoryOptions options
    ) {
        CompletableFuture<RoomClient.RoomCloudflareRealtimeKitClientAdapter> future = new CompletableFuture<>();

        try {
            Activity activity = AndroidActivityTracker.getCurrentActivity();
            if (activity == null) {
                future.completeExceptionally(new IllegalStateException(
                        "EdgeBase room media transport requires a foreground Android Activity. " +
                                "Call AndroidActivityTracker.initialize(context) during app startup. " +
                                "See " + DOCS_URL
                ));
                return future;
            }

            Object meeting = buildMeeting(activity);
            Object meetingInfo = createMeetingInfo(options);

            invokeMeetingInit(
                    meeting,
                    meetingInfo,
                    () -> {
                        try {
                            future.complete(new AndroidRoomCloudflareRealtimeKitClientAdapter(meeting));
                        } catch (Exception error) {
                            future.completeExceptionally(error);
                        }
                    },
                    error -> future.completeExceptionally(new IllegalStateException(
                            "RealtimeKit init failed: " + errorMessage(error)
                    ))
            );
        } catch (Throwable error) {
            future.completeExceptionally(new IllegalStateException(
                    "RealtimeKit transport setup failed. See " + DOCS_URL,
                    error
            ));
        }

        return future;
    }

    private static boolean isRealtimeKitAvailable() {
        return hasClass("com.cloudflare.realtimekit.RealtimeKitMeetingBuilder")
                && hasClass("com.cloudflare.realtimekit.models.RtkMeetingInfo");
    }

    private static boolean hasClass(String className) {
        try {
            Class.forName(className);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static Object buildMeeting(Activity activity) throws Exception {
        Class<?> builderClass = Class.forName("com.cloudflare.realtimekit.RealtimeKitMeetingBuilder");
        Object builderInstance = builderClass.getField("INSTANCE").get(null);
        Method build = builderClass.getMethod("build", Activity.class);
        return build.invoke(builderInstance, activity);
    }

    private static Object createMeetingInfo(RoomClient.RoomCloudflareRealtimeKitClientFactoryOptions options) throws Exception {
        Class<?> meetingInfoClass = Class.forName("com.cloudflare.realtimekit.models.RtkMeetingInfo");
        Constructor<?> constructor = meetingInfoClass.getConstructor(
                String.class,
                boolean.class,
                boolean.class,
                String.class
        );
        return constructor.newInstance(
                options.getAuthToken(),
                options.isEnableAudio(),
                options.isEnableVideo(),
                options.getBaseDomain()
        );
    }

    private static void invokeMeetingInit(
            Object meeting,
            Object meetingInfo,
            Runnable onSuccess,
            java.util.function.Consumer<Object> onFailure
    ) throws Exception {
        Class<?> function0Class = Class.forName("kotlin.jvm.functions.Function0");
        Class<?> function1Class = Class.forName("kotlin.jvm.functions.Function1");
        Method init = meeting.getClass().getMethod(
                "init",
                meetingInfo.getClass(),
                function0Class,
                function1Class
        );
        init.invoke(
                meeting,
                createFunction0Proxy(function0Class, onSuccess),
                createFunction1Proxy(function1Class, onFailure)
        );
    }

    private static final class AndroidRoomCloudflareRealtimeKitClientAdapter
            implements RoomClient.RoomCloudflareRealtimeKitClientAdapter {
        private final Object meeting;
        private final Map<Integer, RoomClient.RoomCloudflareParticipantListener> listeners = new ConcurrentHashMap<>();
        private final Object participantBridge;

        private AndroidRoomCloudflareRealtimeKitClientAdapter(Object meeting) throws Exception {
            this.meeting = meeting;
            this.participantBridge = createParticipantsListenerProxy();
        }

        @Override
        public CompletableFuture<Void> joinRoom() {
            try {
                invokeSingleArgMethod(meeting, "addParticipantsEventListener", participantBridge);
            } catch (Throwable error) {
                return CompletableFuture.failedFuture(error);
            }

            CompletableFuture<Void> future = invokeCompletionMethod(meeting, "joinRoom");
            future.whenComplete((ignored, error) -> {
                if (error != null) {
                    try {
                        invokeSingleArgMethod(meeting, "removeParticipantsEventListener", participantBridge);
                    } catch (Throwable ignoredError) {
                    }
                }
            });
            return future;
        }

        @Override
        public CompletableFuture<Void> leaveRoom() {
            try {
                invokeSingleArgMethod(meeting, "removeParticipantsEventListener", participantBridge);
            } catch (Throwable ignored) {
            }
            return invokeCompletionMethod(meeting, "leaveRoom");
        }

        @Override
        public CompletableFuture<Void> enableAudio() {
            try {
                return invokeErrorCallbackMethod(getLocalUser(), "enableAudio");
            } catch (Exception error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Void> disableAudio() {
            try {
                return invokeErrorCallbackMethod(getLocalUser(), "disableAudio");
            } catch (Exception error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Void> enableVideo() {
            try {
                return invokeErrorCallbackMethod(getLocalUser(), "enableVideo");
            } catch (Exception error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Void> disableVideo() {
            try {
                return invokeErrorCallbackMethod(getLocalUser(), "disableVideo");
            } catch (Exception error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Void> enableScreenShare() {
            try {
                Object error = invokeNoArgMethod(getLocalUser(), "enableScreenShare");
                if (error != null) {
                    return CompletableFuture.failedFuture(
                            new IllegalStateException("RealtimeKit enableScreenShare failed: " + errorMessage(error))
                    );
                }
                return CompletableFuture.completedFuture(null);
            } catch (Throwable error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Void> disableScreenShare() {
            try {
                invokeNoArgMethod(getLocalUser(), "disableScreenShare");
                return CompletableFuture.completedFuture(null);
            } catch (Throwable error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Void> setAudioDevice(String deviceId) {
            try {
                Object localUser = getLocalUser();
                Object selected = findDeviceById((List<?>) invokeNoArgMethod(localUser, "getAudioDevices"), deviceId);
                if (selected == null) {
                    return CompletableFuture.failedFuture(
                            new IllegalStateException("Unknown audio input device: " + deviceId)
                    );
                }
                invokeSingleArgMethod(localUser, "setAudioDevice", selected);
                return CompletableFuture.completedFuture(null);
            } catch (Throwable error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Void> setVideoDevice(String deviceId) {
            try {
                Object localUser = getLocalUser();
                Object selected = findDeviceById((List<?>) invokeNoArgMethod(localUser, "getVideoDevices"), deviceId);
                if (selected == null) {
                    return CompletableFuture.failedFuture(
                            new IllegalStateException("Unknown video input device: " + deviceId)
                    );
                }
                invokeSingleArgMethod(localUser, "setVideoDevice", selected);
                return CompletableFuture.completedFuture(null);
            } catch (Throwable error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public RoomClient.RoomCloudflareParticipantSnapshot getLocalParticipant() {
            try {
                return snapshotFromParticipant(getLocalUser(), null, null, null);
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to read local RealtimeKit participant.", error);
            }
        }

        @Override
        public List<RoomClient.RoomCloudflareParticipantSnapshot> getJoinedParticipants() {
            try {
                return snapshotsFromJoinedParticipants(invokeNoArgMethod(meeting, "getParticipants"));
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to read joined RealtimeKit participants.", error);
            }
        }

        @Override
        public Object buildView(
                RoomClient.RoomCloudflareParticipantSnapshot participant,
                String kind,
                boolean isSelf
        ) {
            try {
                Object participantHandle = participant.getParticipantHandle();
                if (participantHandle == null) {
                    return null;
                }
                if ("video".equals(kind)) {
                    return isSelf
                            ? invokeNoArgMethod(getLocalUser(), "getSelfPreview")
                            : invokeNoArgMethod(participantHandle, "getVideoView");
                }
                if ("screen".equals(kind)) {
                    return invokeNoArgMethod(participantHandle, "getScreenShareVideoView");
                }
                return null;
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to build RealtimeKit media view.", error);
            }
        }

        @Override
        public void addListener(RoomClient.RoomCloudflareParticipantListener listener) {
            listeners.put(listener.hashCode(), listener);
        }

        @Override
        public void removeListener(RoomClient.RoomCloudflareParticipantListener listener) {
            listeners.remove(listener.hashCode());
        }

        private Object createParticipantsListenerProxy() throws Exception {
            Class<?> listenerClass = Class.forName("com.cloudflare.realtimekit.participants.RtkParticipantsEventListener");
            return Proxy.newProxyInstance(
                    listenerClass.getClassLoader(),
                    new Class<?>[]{listenerClass},
                    (proxy, method, args) -> {
                        if (args == null) {
                            args = new Object[0];
                        }
                        switch (method.getName()) {
                            case "onParticipantJoin" -> notifyParticipantJoin(args[0]);
                            case "onParticipantLeave" -> notifyParticipantLeave(args[0]);
                            case "onAudioUpdate" -> notifyAudioUpdate(args[0], (Boolean) args[1]);
                            case "onVideoUpdate" -> notifyVideoUpdate(args[0], (Boolean) args[1]);
                            case "onScreenShareUpdate" -> notifyScreenShareUpdate(args[0], (Boolean) args[1]);
                            case "onUpdate" -> notifyParticipantsSync(args[0]);
                            default -> {
                            }
                        }
                        return proxyReturnValue(proxy, method, args);
                    }
            );
        }

        private void notifyParticipantJoin(Object participantHandle) {
            RoomClient.RoomCloudflareParticipantSnapshot snapshot = snapshotSafely(
                    participantHandle,
                    null,
                    null,
                    null
            );
            listeners.values().forEach(listener -> listener.onParticipantJoin(snapshot));
        }

        private void notifyParticipantLeave(Object participantHandle) {
            RoomClient.RoomCloudflareParticipantSnapshot snapshot = snapshotSafely(
                    participantHandle,
                    null,
                    null,
                    null
            );
            listeners.values().forEach(listener -> listener.onParticipantLeave(snapshot));
        }

        private void notifyAudioUpdate(Object participantHandle, boolean enabled) {
            RoomClient.RoomCloudflareParticipantSnapshot snapshot = snapshotSafely(
                    participantHandle,
                    enabled,
                    null,
                    null
            );
            listeners.values().forEach(listener -> listener.onAudioUpdate(snapshot, enabled));
        }

        private void notifyVideoUpdate(Object participantHandle, boolean enabled) {
            RoomClient.RoomCloudflareParticipantSnapshot snapshot = snapshotSafely(
                    participantHandle,
                    null,
                    enabled,
                    null
            );
            listeners.values().forEach(listener -> listener.onVideoUpdate(snapshot, enabled));
        }

        private void notifyScreenShareUpdate(Object participantHandle, boolean enabled) {
            RoomClient.RoomCloudflareParticipantSnapshot snapshot = snapshotSafely(
                    participantHandle,
                    null,
                    null,
                    enabled
            );
            listeners.values().forEach(listener -> listener.onScreenShareUpdate(snapshot, enabled));
        }

        private void notifyParticipantsSync(Object participantsHandle) {
            List<RoomClient.RoomCloudflareParticipantSnapshot> snapshots;
            try {
                snapshots = snapshotsFromJoinedParticipants(participantsHandle);
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to read RealtimeKit participants sync.", error);
            }
            listeners.values().forEach(listener -> listener.onParticipantsSync(snapshots));
        }

        private Object getLocalUser() throws Exception {
            return invokeNoArgMethod(meeting, "getLocalUser");
        }

        private RoomClient.RoomCloudflareParticipantSnapshot snapshotSafely(
                Object participantHandle,
                Boolean audioEnabled,
                Boolean videoEnabled,
                Boolean screenShareEnabled
        ) {
            try {
                return snapshotFromParticipant(participantHandle, audioEnabled, videoEnabled, screenShareEnabled);
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to read RealtimeKit participant state.", error);
            }
        }

        private List<RoomClient.RoomCloudflareParticipantSnapshot> snapshotsFromJoinedParticipants(Object participantsHandle) throws Exception {
            List<?> joined = (List<?>) invokeNoArgMethod(participantsHandle, "getJoined");
            List<RoomClient.RoomCloudflareParticipantSnapshot> result = new ArrayList<>();
            for (Object participant : joined) {
                result.add(snapshotFromParticipant(participant, null, null, null));
            }
            return result;
        }

        private RoomClient.RoomCloudflareParticipantSnapshot snapshotFromParticipant(
                Object participantHandle,
                Boolean audioEnabledOverride,
                Boolean videoEnabledOverride,
                Boolean screenShareEnabledOverride
        ) throws Exception {
            boolean audioEnabled = audioEnabledOverride != null
                    ? audioEnabledOverride
                    : (Boolean) invokeNoArgMethod(participantHandle, "getAudioEnabled");
            boolean videoEnabled = videoEnabledOverride != null
                    ? videoEnabledOverride
                    : (Boolean) invokeNoArgMethod(participantHandle, "getVideoEnabled");
            boolean screenShareEnabled = screenShareEnabledOverride != null
                    ? screenShareEnabledOverride
                    : (Boolean) invokeNoArgMethod(participantHandle, "getScreenShareEnabled");

            return new RoomClient.RoomCloudflareParticipantSnapshot(
                    (String) invokeNoArgMethod(participantHandle, "getId"),
                    (String) invokeNoArgMethod(participantHandle, "getUserId"),
                    (String) invokeNoArgMethod(participantHandle, "getName"),
                    (String) invokeNoArgMethod(participantHandle, "getPicture"),
                    (String) invokeNoArgMethod(participantHandle, "getCustomParticipantId"),
                    audioEnabled,
                    videoEnabled,
                    screenShareEnabled,
                    participantHandle
            );
        }

        private static Object findDeviceById(List<?> devices, String deviceId) throws Exception {
            for (Object device : devices) {
                String candidateId = (String) invokeNoArgMethod(device, "getId");
                if (Objects.equals(deviceId, candidateId)) {
                    return device;
                }
            }
            return null;
        }
    }

    private static CompletableFuture<Void> invokeCompletionMethod(Object target, String methodName) {
        CompletableFuture<Void> future = new CompletableFuture<>();
        try {
            Class<?> function0Class = Class.forName("kotlin.jvm.functions.Function0");
            Class<?> function1Class = Class.forName("kotlin.jvm.functions.Function1");
            Method method = target.getClass().getMethod(methodName, function0Class, function1Class);
            method.invoke(
                    target,
                    createFunction0Proxy(function0Class, () -> future.complete(null)),
                    createFunction1Proxy(function1Class, error -> future.completeExceptionally(
                            new IllegalStateException("RealtimeKit " + methodName + " failed: " + errorMessage(error))
                    ))
            );
        } catch (Throwable error) {
            future.completeExceptionally(error);
        }
        return future;
    }

    private static CompletableFuture<Void> invokeErrorCallbackMethod(Object target, String methodName) {
        CompletableFuture<Void> future = new CompletableFuture<>();
        try {
            Class<?> function1Class = Class.forName("kotlin.jvm.functions.Function1");
            Method method = target.getClass().getMethod(methodName, function1Class);
            method.invoke(
                    target,
                    createFunction1Proxy(function1Class, error -> {
                        if (error != null) {
                            future.completeExceptionally(new IllegalStateException(
                                    "RealtimeKit " + methodName + " failed: " + errorMessage(error)
                            ));
                        } else {
                            future.complete(null);
                        }
                    })
            );
        } catch (Throwable error) {
            future.completeExceptionally(error);
        }
        return future;
    }

    private static Object createFunction0Proxy(Class<?> function0Class, Runnable handler) {
        return Proxy.newProxyInstance(
                function0Class.getClassLoader(),
                new Class<?>[]{function0Class},
                (proxy, method, args) -> {
                    if ("invoke".equals(method.getName())) {
                        handler.run();
                        return kotlinUnit();
                    }
                    return proxyReturnValue(proxy, method, args);
                }
        );
    }

    private static Object createFunction1Proxy(Class<?> function1Class, java.util.function.Consumer<Object> handler) {
        return Proxy.newProxyInstance(
                function1Class.getClassLoader(),
                new Class<?>[]{function1Class},
                (proxy, method, args) -> {
                    if ("invoke".equals(method.getName())) {
                        handler.accept(args == null || args.length == 0 ? null : args[0]);
                        return kotlinUnit();
                    }
                    return proxyReturnValue(proxy, method, args);
                }
        );
    }

    private static Object proxyReturnValue(Object proxy, Method method, Object[] args) throws Exception {
        return switch (method.getName()) {
            case "hashCode" -> System.identityHashCode(proxy);
            case "equals" -> proxy == (args == null || args.length == 0 ? null : args[0]);
            case "toString" -> proxy.getClass().getName();
            default -> defaultValue(method.getReturnType());
        };
    }

    private static Object kotlinUnit() throws Exception {
        Class<?> unitClass = Class.forName("kotlin.Unit");
        return unitClass.getField("INSTANCE").get(null);
    }

    private static Object defaultValue(Class<?> returnType) {
        if (!returnType.isPrimitive()) {
            return null;
        }
        if (returnType == boolean.class) {
            return false;
        }
        if (returnType == char.class) {
            return '\0';
        }
        if (returnType == byte.class || returnType == short.class || returnType == int.class) {
            return 0;
        }
        if (returnType == long.class) {
            return 0L;
        }
        if (returnType == float.class) {
            return 0f;
        }
        if (returnType == double.class) {
            return 0d;
        }
        return null;
    }

    private static String errorMessage(Object error) {
        if (error == null) {
            return "unknown error";
        }
        try {
            Object message = invokeNoArgMethod(error, "getMessage");
            if (message instanceof String string && !string.isBlank()) {
                return string;
            }
        } catch (Throwable ignored) {
        }
        return String.valueOf(error);
    }

    private static Object invokeNoArgMethod(Object target, String methodName) throws Exception {
        Method method = target.getClass().getMethod(methodName);
        return method.invoke(target);
    }

    private static Object invokeSingleArgMethod(Object target, String methodName, Object argument) throws Exception {
        Method method = findSingleArgMethod(target.getClass(), methodName, argument == null ? null : argument.getClass());
        if (method == null) {
            throw new NoSuchMethodException(target.getClass().getName() + "#" + methodName);
        }
        return method.invoke(target, argument);
    }

    private static Method findSingleArgMethod(Class<?> type, String methodName, Class<?> argumentType) {
        for (Method method : type.getMethods()) {
            if (!method.getName().equals(methodName) || method.getParameterCount() != 1) {
                continue;
            }
            Class<?> parameterType = method.getParameterTypes()[0];
            if (argumentType == null || parameterType.isAssignableFrom(argumentType)) {
                return method;
            }
        }
        return null;
    }
}
