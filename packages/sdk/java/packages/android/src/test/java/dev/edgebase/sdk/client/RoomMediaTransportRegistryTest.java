package dev.edgebase.sdk.client;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

class RoomMediaTransportRegistryTest {
    @Test
    void clientConstruction_noops_when_realtimekit_runtime_is_absent() {
        assertDoesNotThrow(() -> {
            ClientEdgeBase client = new ClientEdgeBase("http://localhost:8688");
            client.destroy();
        });
    }

    @Test
    void registryHelper_noops_when_realtimekit_runtime_is_absent() {
        assertDoesNotThrow(RoomCloudflareRealtimeKitAndroid::maybeRegisterDefaultTransportFactory);
    }
}
