// EdgeBase C# SDK — Atomic field operation helpers.
// Usage:
//   await ref.UpdateAsync(id, new Dictionary<string, object?> {
//       { "views", FieldOps.Increment(1) },
//       { "temp",  FieldOps.DeleteField() },
//   });

namespace EdgeBase
{
    /// <summary>Atomic field operation markers for update methods.</summary>
    public static class FieldOps
    {
        /// <summary>
        /// Increment a numeric field atomically.
        /// Server: field = COALESCE(field, 0) + value.
        /// </summary>
        public static System.Collections.Generic.Dictionary<string, object?> Increment(double value = 1)
        {
            return new System.Collections.Generic.Dictionary<string, object?>
            {
                { "$op", "increment" },
                { "value", value }
            };
        }

        /// <summary>
        /// Delete a field (set to NULL).
        /// Server: field = NULL.
        /// </summary>
        public static System.Collections.Generic.Dictionary<string, object?> DeleteField()
        {
            return new System.Collections.Generic.Dictionary<string, object?>
            {
                { "$op", "deleteField" }
            };
        }
    }
}
