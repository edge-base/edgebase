// EdgeBase Kotlin SDK — Field operation helpers.
//
// Atomic field operations: increment, deleteField.
// Format mirrors JS SDK (field-ops.ts) and server op-parser.ts ($op key).

package dev.edgebase.sdk.core

/**
 * Field operation helpers for atomic updates.
 *
 * Usage:
 * ```kotlin
 * docRef.update(mapOf("views" to FieldOps.increment(1)))
 * docRef.update(mapOf("temp" to FieldOps.deleteField()))
 * ```
 */
object FieldOps {
    /**
     * Atomically increment a numeric field.
     */
    fun increment(value: Number): Map<String, Any> = mapOf(
        "\$op" to "increment",
        "value" to value
    )

    /**
     * Mark a field for deletion.
     */
    fun deleteField(): Map<String, Any> = mapOf(
        "\$op" to "deleteField"
    )
}
