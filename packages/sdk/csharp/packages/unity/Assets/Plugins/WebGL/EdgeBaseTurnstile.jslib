var LibraryEdgeBaseTurnstile = {
  $EdgeBaseTurnstileEnsureBridge: function () {
    var windowObject = typeof window !== 'undefined' ? window : null;
    if (!windowObject) {
      return null;
    }

    if (windowObject.EdgeBaseTurnstileBridge && windowObject.EdgeBaseTurnstileBridge.__edgebaseReady) {
      return windowObject.EdgeBaseTurnstileBridge;
    }

    var scriptPromise = null;
    var pending = {};

    function send(gameObjectName, methodName, payload) {
      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, methodName, payload);
        return;
      }

      if (typeof Module !== 'undefined' && Module && typeof Module.SendMessage === 'function') {
        Module.SendMessage(gameObjectName, methodName, payload);
        return;
      }

      if (windowObject.unityInstance && typeof windowObject.unityInstance.SendMessage === 'function') {
        windowObject.unityInstance.SendMessage(gameObjectName, methodName, payload);
      }
    }

    function ensureScript() {
      if (windowObject.turnstile) {
        return Promise.resolve(windowObject.turnstile);
      }

      if (scriptPromise) {
        return scriptPromise;
      }

      scriptPromise = new Promise(function (resolve, reject) {
        var existing = document.querySelector('script[data-edgebase-turnstile]');
        if (existing) {
          if (windowObject.turnstile) {
            resolve(windowObject.turnstile);
            return;
          }

          existing.addEventListener('load', function () { resolve(windowObject.turnstile); }, { once: true });
          existing.addEventListener('error', reject, { once: true });
          return;
        }

        var script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.edgebaseTurnstile = 'true';
        script.onload = function () { resolve(windowObject.turnstile); };
        script.onerror = function () { reject(new Error('Failed to load the Turnstile API script.')); };
        document.head.appendChild(script);
      });

      return scriptPromise;
    }

    function ensurePreviewHost() {
      var existing = document.getElementById('edgebase-captcha-preview-host');
      if (existing) {
        positionPreviewHost(existing);
        return existing;
      }

      var host = document.createElement('section');
      host.id = 'edgebase-captcha-preview-host';
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647';
      host.style.width = '320px';
      host.style.minHeight = '78px';
      host.style.boxSizing = 'border-box';
      host.style.display = 'flex';
      host.style.alignItems = 'center';
      host.style.justifyContent = 'center';
      host.style.pointerEvents = 'auto';
      host.style.transform = 'translateX(-50%)';

      var container = document.createElement('div');
      container.id = 'edgebase-captcha-preview-container';
      container.style.width = '300px';
      container.style.minHeight = '78px';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';

      host.appendChild(container);
      document.body.appendChild(host);
      positionPreviewHost(host);

      if (!windowObject.__edgebaseTurnstilePreviewBound) {
        var refreshPreviewHostPosition = function () {
          var previewHost = document.getElementById('edgebase-captcha-preview-host');
          if (previewHost) {
            positionPreviewHost(previewHost);
          }
        };

        windowObject.addEventListener('resize', refreshPreviewHostPosition);
        windowObject.addEventListener('scroll', refreshPreviewHostPosition, { passive: true });
        windowObject.__edgebaseTurnstilePreviewBound = true;
      }

      return host;
    }

    function positionPreviewHost(host) {
      var canvas = document.getElementById('unity-canvas');
      if (!canvas) {
        host.style.top = '24px';
        host.style.left = '50%';
        return;
      }

      var rect = canvas.getBoundingClientRect();
      var scaleY = rect.height > 0 ? rect.height / 600 : 1;
      var top = rect.top + (248 * scaleY);
      host.style.top = Math.max(12, Math.round(top)) + 'px';
      host.style.left = Math.round(rect.left + (rect.width / 2)) + 'px';
    }

    function mountPreview(gameObjectName, siteKey, action, resetNonce) {
      ensureScript().then(function () {
        var host = ensurePreviewHost();
        var container = host.querySelector('#edgebase-captcha-preview-container');
        if (!container) {
          return;
        }

        var signature = siteKey + '|' + action + '|' + resetNonce;
        if (host.dataset.signature === signature && host.dataset.widgetId) {
          return;
        }

        host.dataset.signature = signature;
        container.innerHTML = '';

        var widgetHost = document.createElement('div');
        container.appendChild(widgetHost);

        send(gameObjectName, 'OnEdgeBaseCaptchaPreviewMessage', JSON.stringify({ type: 'debug', value: 'render-start' }));
        var widgetId = windowObject.turnstile.render(widgetHost, {
          sitekey: siteKey,
          action: action,
          appearance: 'always',
          callback: function (token) {
            send(gameObjectName, 'OnEdgeBaseCaptchaPreviewMessage', JSON.stringify({ type: 'token', value: token }));
            windowObject.setTimeout(function () {
              try {
                windowObject.turnstile.reset(widgetId);
              } catch (_) {}
            }, 1600);
          },
          'error-callback': function (error) {
            send(gameObjectName, 'OnEdgeBaseCaptchaPreviewMessage', JSON.stringify({ type: 'error', value: String(error) }));
          },
          'before-interactive-callback': function () {
            send(gameObjectName, 'OnEdgeBaseCaptchaPreviewMessage', JSON.stringify({ type: 'interactive', value: 'show' }));
          },
          'after-interactive-callback': function () {
            send(gameObjectName, 'OnEdgeBaseCaptchaPreviewMessage', JSON.stringify({ type: 'interactive', value: 'hide' }));
          },
          'timeout-callback': function () {
            send(gameObjectName, 'OnEdgeBaseCaptchaPreviewMessage', JSON.stringify({ type: 'error', value: 'timeout' }));
          }
        });
        host.dataset.widgetId = String(widgetId);
        send(gameObjectName, 'OnEdgeBaseCaptchaPreviewMessage', JSON.stringify({ type: 'ready', value: 'ready' }));
      }).catch(function (error) {
        send(gameObjectName, 'OnEdgeBaseCaptchaPreviewMessage', JSON.stringify({ type: 'error', value: String(error) }));
      });
    }

    function resetPreview() {
      var host = document.getElementById('edgebase-captcha-preview-host');
      if (!host || !host.dataset.widgetId || !windowObject.turnstile) {
        return;
      }

      try {
        windowObject.turnstile.reset(host.dataset.widgetId);
      } catch (_) {}
    }

    function requestToken(gameObjectName, requestId, siteKey, action) {
      ensureScript().then(function () {
        cancelTokenRequest(requestId);

        var backdrop = document.createElement('div');
        backdrop.dataset.edgebaseTurnstileRequest = requestId;
        backdrop.style.position = 'fixed';
        backdrop.style.inset = '0';
        backdrop.style.background = 'rgba(19, 16, 11, 0.42)';
        backdrop.style.display = 'none';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';
        backdrop.style.zIndex = '2147483647';

        var card = document.createElement('div');
        card.style.minWidth = '340px';
        card.style.minHeight = '92px';
        card.style.padding = '18px';
        card.style.borderRadius = '24px';
        card.style.background = '#fffdf9';
        card.style.boxShadow = '0 24px 60px rgba(15, 11, 6, 0.22)';
        card.style.display = 'flex';
        card.style.alignItems = 'center';
        card.style.justifyContent = 'center';

        var container = document.createElement('div');
        backdrop.appendChild(card);
        card.appendChild(container);
        document.body.appendChild(backdrop);

        pending[requestId] = { backdrop: backdrop };

        windowObject.turnstile.render(container, {
          sitekey: siteKey,
          action: action,
          appearance: 'interaction-only',
          callback: function (token) {
            send(gameObjectName, 'OnEdgeBaseCaptchaTokenMessage', JSON.stringify({ requestId: requestId, type: 'token', value: token }));
            cancelTokenRequest(requestId);
          },
          'error-callback': function (error) {
            send(gameObjectName, 'OnEdgeBaseCaptchaTokenMessage', JSON.stringify({ requestId: requestId, type: 'error', value: String(error) }));
            cancelTokenRequest(requestId);
          },
          'before-interactive-callback': function () {
            backdrop.style.display = 'flex';
          },
          'after-interactive-callback': function () {
            backdrop.style.display = 'none';
          },
          'timeout-callback': function () {
            send(gameObjectName, 'OnEdgeBaseCaptchaTokenMessage', JSON.stringify({ requestId: requestId, type: 'error', value: 'timeout' }));
            cancelTokenRequest(requestId);
          }
        });

        send(gameObjectName, 'OnEdgeBaseCaptchaTokenMessage', JSON.stringify({ requestId: requestId, type: 'debug', value: 'render-mounted' }));
      }).catch(function (error) {
        send(gameObjectName, 'OnEdgeBaseCaptchaTokenMessage', JSON.stringify({ requestId: requestId, type: 'error', value: String(error) }));
      });
    }

    function cancelTokenRequest(requestId) {
      var entry = pending[requestId];
      if (!entry) {
        return;
      }

      if (entry.backdrop && entry.backdrop.parentNode) {
        entry.backdrop.parentNode.removeChild(entry.backdrop);
      }

      delete pending[requestId];
    }

    windowObject.EdgeBaseTurnstileBridge = {
      __edgebaseReady: true,
      mountPreview: mountPreview,
      resetPreview: resetPreview,
      requestToken: requestToken,
      cancelTokenRequest: cancelTokenRequest
    };

    return windowObject.EdgeBaseTurnstileBridge;
  },

  EB_Turnstile_RequestToken__deps: ['$EdgeBaseTurnstileEnsureBridge'],
  EB_Turnstile_RequestToken: function (gameObjectNamePtr, requestIdPtr, siteKeyPtr, actionPtr) {
    var bridge = EdgeBaseTurnstileEnsureBridge();
    if (!bridge) {
      return;
    }

    bridge.requestToken(
      UTF8ToString(gameObjectNamePtr),
      UTF8ToString(requestIdPtr),
      UTF8ToString(siteKeyPtr),
      UTF8ToString(actionPtr)
    );
  },

  EB_Turnstile_CancelTokenRequest__deps: ['$EdgeBaseTurnstileEnsureBridge'],
  EB_Turnstile_CancelTokenRequest: function (requestIdPtr) {
    var bridge = EdgeBaseTurnstileEnsureBridge();
    if (!bridge) {
      return;
    }

    bridge.cancelTokenRequest(UTF8ToString(requestIdPtr));
  },

  EB_Turnstile_MountPreview__deps: ['$EdgeBaseTurnstileEnsureBridge'],
  EB_Turnstile_MountPreview: function (gameObjectNamePtr, siteKeyPtr, actionPtr, resetNonce) {
    var bridge = EdgeBaseTurnstileEnsureBridge();
    if (!bridge) {
      return;
    }

    bridge.mountPreview(
      UTF8ToString(gameObjectNamePtr),
      UTF8ToString(siteKeyPtr),
      UTF8ToString(actionPtr),
      resetNonce
    );
  },

  EB_Turnstile_ResetPreview__deps: ['$EdgeBaseTurnstileEnsureBridge'],
  EB_Turnstile_ResetPreview: function () {
    var bridge = EdgeBaseTurnstileEnsureBridge();
    if (!bridge) {
      return;
    }

    bridge.resetPreview();
  }
};

autoAddDeps(LibraryEdgeBaseTurnstile, '$EdgeBaseTurnstileEnsureBridge');
mergeInto(LibraryManager.library, LibraryEdgeBaseTurnstile);
