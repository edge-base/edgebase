package dev.edgebase.sdk.client

import kotlin.test.Test
import kotlin.test.assertNotNull

class RoomMediaTransportJsTest {
    @Test
    fun cloudflareRealtimeKitFactory_isAvailableOnJs() {
        assertNotNull(defaultCloudflareRealtimeKitClientFactory())
    }

    @Test
    fun p2pRuntimeFactory_isAvailableOnJs() {
        assertNotNull(defaultP2PMediaRuntimeFactory())
    }
}
