package dev.edgebase.sdk.client;

/** An incomplete access/refresh pair was rejected before exposure. */
public final class InvalidTokenPairException extends IllegalStateException {
    private final String operation;

    public InvalidTokenPairException(String operation) {
        super("EdgeBase token pair is incomplete during " + operation + ".");
        this.operation = operation;
    }

    public String getOperation() {
        return operation;
    }
}
