// EdgeBase Kotlin SDK — Apple (iOS/macOS) Keychain token storage.

@file:OptIn(
    kotlinx.cinterop.ExperimentalForeignApi::class,
    kotlinx.cinterop.BetaInteropApi::class
)

package dev.edgebase.sdk.client

import kotlinx.cinterop.CPointer
import kotlinx.cinterop.CPointed
import kotlinx.cinterop.CPointerVarOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.interpretObjCPointer
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.rawValue
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.value
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import platform.CoreFoundation.CFDictionaryRef
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSMutableDictionary
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.NSUserDefaults
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.SecItemUpdate
import platform.Security.errSecDuplicateItem
import platform.Security.errSecItemNotFound
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData

actual fun createDefaultTokenStorage(): TokenStorage = KeychainTokenStorage()

/** A diagnostic Keychain failure. The OSStatus is preserved for support logs. */
class TokenStorageException(
    val operation: String,
    val osStatus: Int
) : Exception("Apple Keychain $operation failed (OSStatus $osStatus)")

/**
 * Security.framework-backed token storage. Access and refresh tokens are
 * encoded together in one generic-password item so a refresh-token rotation
 * cannot leave a mixed pair after a partial write.
 */
class KeychainTokenStorage(
    private val service: String = "dev.edgebase.sdk.tokens"
) : DurableTokenStorage {
    private val account = "tokens"

    init {
        // Versions before 0.3.9 used this private NSUserDefaults suite. Purge
        // both known plaintext keys immediately; security takes precedence
        // over silently restoring a legacy plaintext session.
        NSUserDefaults(suiteName = "dev.edgebase.sdk.tokens").apply {
            removeObjectForKey("edgebase_access_token")
            removeObjectForKey("edgebase_refresh_token")
            synchronize()
        }
    }

    override suspend fun getTokens(): TokenPair? {
        val query = baseQuery().apply {
            setObject(true, forKey = cfString(kSecReturnData))
            setObject(cfString(kSecMatchLimitOne), forKey = cfString(kSecMatchLimit))
        }

        return memScoped {
            val result = alloc<CPointerVarOf<CPointer<out CPointed>>>()
            val status = withCFDictionary(query) { queryRef ->
                SecItemCopyMatching(queryRef, result.ptr)
            }
            if (status == errSecItemNotFound) return@memScoped null
            if (status != errSecSuccess) throw TokenStorageException("read", status)

            val retainedResult = result.value
                ?: throw TokenStorageException("read-empty-result", status)
            val objectValue = CFBridgingRelease(retainedResult)
            val data = objectValue as? NSData
                ?: throw TokenStorageException("read-invalid-data", status)
            val text = NSString.create(data = data, encoding = NSUTF8StringEncoding)
                ?: throw TokenStorageException("read-invalid-utf8", status)
            decodePair(text.toString())
        }
    }

    override suspend fun saveTokens(pair: TokenPair) {
        val text = buildJsonObject {
            put("accessToken", pair.accessToken)
            put("refreshToken", pair.refreshToken)
        }.toString()
        val data = NSString.create(string = text)
            .dataUsingEncoding(NSUTF8StringEncoding)
            ?: throw TokenStorageException("encode", -1)

        val update = NSMutableDictionary().apply {
            setObject(data, forKey = cfString(kSecValueData))
        }
        val updateStatus = withCFDictionary(baseQuery()) { queryRef ->
            withCFDictionary(update) { updateRef ->
                SecItemUpdate(queryRef, updateRef)
            }
        }
        if (updateStatus == errSecSuccess) return
        if (updateStatus != errSecItemNotFound) {
            throw TokenStorageException("update", updateStatus)
        }

        val add = baseQuery().apply {
            setObject(data, forKey = cfString(kSecValueData))
            setObject(
                cfString(kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly),
                forKey = cfString(kSecAttrAccessible)
            )
        }
        val addStatus = withCFDictionary(add) { attributes ->
            SecItemAdd(attributes, null)
        }
        if (addStatus == errSecDuplicateItem) {
            // Another concurrent writer won the add race. Retry the update so
            // the caller observes either a durable new pair or a real error.
            val retryStatus = withCFDictionary(baseQuery()) { queryRef ->
                withCFDictionary(update) { updateRef -> SecItemUpdate(queryRef, updateRef) }
            }
            if (retryStatus != errSecSuccess) throw TokenStorageException("update-after-race", retryStatus)
        } else if (addStatus != errSecSuccess) {
            throw TokenStorageException("add", addStatus)
        }
    }

    override suspend fun clearTokens() {
        val status = withCFDictionary(baseQuery()) { queryRef -> SecItemDelete(queryRef) }
        if (status != errSecSuccess && status != errSecItemNotFound) {
            throw TokenStorageException("delete", status)
        }
    }

    private fun baseQuery(): NSMutableDictionary = NSMutableDictionary().apply {
        setObject(cfString(kSecClassGenericPassword), forKey = cfString(kSecClass))
        setObject(service, forKey = cfString(kSecAttrService))
        setObject(account, forKey = cfString(kSecAttrAccount))
    }

    private fun decodePair(text: String): TokenPair {
        val payload = try {
            Json.parseToJsonElement(text).jsonObject
        } catch (_: Exception) {
            throw TokenStorageException("decode", -1)
        }
        val access = payload["accessToken"]?.jsonPrimitive?.contentOrNull
        val refresh = payload["refreshToken"]?.jsonPrimitive?.contentOrNull
        if (access.isNullOrEmpty() || refresh.isNullOrEmpty()) {
            throw TokenStorageException("decode-fields", -1)
        }
        return TokenPair(accessToken = access, refreshToken = refresh)
    }
}

private fun cfString(value: CPointer<out CPointed>?): NSString {
    val pointer = value ?: throw TokenStorageException("constant-unavailable", -1)
    return interpretObjCPointer(pointer.rawValue)
}

private inline fun <T> withCFDictionary(
    dictionary: NSMutableDictionary,
    block: (CFDictionaryRef?) -> T
): T {
    val retained = CFBridgingRetain(dictionary)
        ?: throw TokenStorageException("dictionary-bridge", -1)
    return try {
        block(retained.reinterpret())
    } finally {
        CFBridgingRelease(retained)
    }
}
