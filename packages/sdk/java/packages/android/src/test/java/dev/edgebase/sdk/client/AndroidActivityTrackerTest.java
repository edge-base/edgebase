package dev.edgebase.sdk.client;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import sun.misc.Unsafe;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AndroidActivityTrackerTest {
    @Test
    void sdkInitializationAfterResumeCapturesFirstInteractiveActivity() throws Exception {
        TestActivity alreadyResumedActivity = allocate(TestActivity.class);
        alreadyResumedActivity.application = allocate(TestApplication.class);

        ClientEdgeBase client = AndroidEdgeBase.client(
            alreadyResumedActivity,
            "https://api.example.test"
        );

        assertSame(alreadyResumedActivity, AndroidActivityTracker.getCurrentActivity());
        client.destroy();
    }

    @Test
    void androidInitializationWithoutActivityFailsFast() {
        AndroidActivityTracker.clearForTest();
        IllegalStateException error = assertThrows(
            IllegalStateException.class,
            ClientEdgeBase::validateAndroidInitialization
        );
        assertTrue(error.getMessage().contains("AndroidEdgeBase.client"));
    }

    /**
     * The Java artifact is a JVM-compatible jar, so it cannot run an Android
     * instrumentation harness itself. This real Activity subclass exercises
     * the explicit post-resume initialization path without relying on lifecycle
     * callback replay; the Kotlin AAR owns the Robolectric lifecycle test.
     */
    private static final class TestActivity extends Activity {
        private Application application;

        @Override
        public Context getApplicationContext() {
            return application;
        }

        @Override
        public boolean isFinishing() {
            return false;
        }
    }

    private static final class TestApplication extends Application {
        @Override
        public void registerActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) {
            // Initialization after resume must capture the supplied Activity
            // synchronously; intentionally do not replay a lifecycle callback.
        }
    }

    private static <T> T allocate(Class<T> type) throws Exception {
        Field field = Unsafe.class.getDeclaredField("theUnsafe");
        field.setAccessible(true);
        Unsafe unsafe = (Unsafe) field.get(null);
        return type.cast(unsafe.allocateInstance(type));
    }
}
