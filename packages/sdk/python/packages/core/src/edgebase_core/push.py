class PushClient:
    """
    Push Client for the EdgeBase Python Core SDK.
    Desktop environments (Windows, macOS, Linux) do not natively support OS-level
    push notifications directly through Python without extensive platform-specific bridges.
    It is recommended to use the Web Push approach for desktop apps or the Admin SDK.
    """

    def __init__(self, http):
        self._http = http

    def register(self):
        """
        Registers the device for push notifications.
        Note: Python natively does not support OS-level push notifications for desktop.
        """
        raise NotImplementedError(
            "Desktop push notifications are not supported in the Python Core SDK natively. Please consider Web Push."
        )

    # Other push receiver events like on_message can be similarly mocked
