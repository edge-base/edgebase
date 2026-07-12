package dev.edgebase.sdk.client;

/** Token storage failed before a replacement session could be exposed. */
public final class TokenPersistenceException extends IllegalStateException {
    private final String operation;

    public TokenPersistenceException(String operation, Throwable cause) {
        super("Token persistence " + operation + " failed before token adoption.", cause);
        this.operation = operation;
    }

    public String getOperation() {
        return operation;
    }
}
