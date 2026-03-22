package dev.edgebase.sdk.client

import kotlin.test.Test
import kotlin.test.assertNotNull

class RoomMediaTransportIosTest {
    @Test
    fun cloudflareRealtimeKitFactory_isAvailableOnIos() {
        assertNotNull(defaultCloudflareRealtimeKitClientFactory())
    }

    @Test
    fun p2pRuntimeFactory_isAvailableOnIos() {
        assertNotNull(defaultP2PMediaRuntimeFactory())
    }
}
