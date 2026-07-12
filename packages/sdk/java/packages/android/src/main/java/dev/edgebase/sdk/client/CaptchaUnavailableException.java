package dev.edgebase.sdk.client;

/**
 * Local runtime failure while CAPTCHA is configured but cannot be completed.
 * This is deliberately distinct from a server-side authentication rejection.
 */
public final class CaptchaUnavailableException extends IllegalStateException {
    public static final String CODE = "captcha-unavailable";

    private final String reason;

    public CaptchaUnavailableException(String reason) {
        this(reason, null);
    }

    public CaptchaUnavailableException(String reason, Throwable cause) {
        super("CAPTCHA unavailable: " + reason, cause);
        this.reason = reason;
    }

    public String getCode() {
        return CODE;
    }

    public String getReason() {
        return reason;
    }
}
