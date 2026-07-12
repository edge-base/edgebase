#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

extern "C" void UnitySendMessage(const char* obj, const char* method, const char* msg);

@interface EBTurnstileRequest : NSObject <WKNavigationDelegate, WKScriptMessageHandler>
@property(nonatomic, copy) NSString* gameObjectName;
@property(nonatomic, copy) NSString* requestId;
@property(nonatomic, copy) NSString* channel;
@property(nonatomic, strong) NSURL* challengeURL;
@property(nonatomic, strong) UIView* overlayView;
@property(nonatomic, strong) UIView* cardView;
@property(nonatomic, strong) WKWebView* webView;
@property(nonatomic, assign) BOOL terminal;
- (instancetype)initWithGameObjectName:(NSString*)gameObjectName
                             requestId:(NSString*)requestId
                          challengeURL:(NSURL*)challengeURL
                               channel:(NSString*)channel;
- (void)finishWithType:(NSString*)type value:(NSString*)value;
@end

static NSMutableDictionary<NSString*, EBTurnstileRequest*>* gEBTurnstileRequests;

static UIViewController* EBRootViewController(void) {
    UIWindow* keyWindow = nil;
    if (@available(iOS 13.0, *)) {
        for (UIScene* scene in UIApplication.sharedApplication.connectedScenes) {
            if (![scene isKindOfClass:[UIWindowScene class]] ||
                scene.activationState != UISceneActivationStateForegroundActive) continue;
            for (UIWindow* candidate in ((UIWindowScene*)scene).windows) {
                if (candidate.isKeyWindow) { keyWindow = candidate; break; }
            }
            if (keyWindow != nil) break;
        }
    }
    if (keyWindow == nil) keyWindow = UIApplication.sharedApplication.keyWindow;
    UIViewController* controller = keyWindow.rootViewController;
    while (controller.presentedViewController != nil) {
        controller = controller.presentedViewController;
    }
    return controller;
}

static void EBSendUnityMessage(
    NSString* gameObjectName,
    NSString* requestId,
    NSString* type,
    NSString* value
) {
    NSDictionary* payload = @{
        @"requestId": requestId ?: @"",
        @"type": type ?: @"",
        @"value": value ?: @""
    };
    NSData* data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    NSString* json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    UnitySendMessage(gameObjectName.UTF8String, "OnEdgeBaseCaptchaTokenMessage", json.UTF8String);
}

static BOOL EBValidChannel(NSString* channel) {
    if (channel.length < 22 || channel.length > 64) return NO;
    NSCharacterSet* invalid = [[NSCharacterSet characterSetWithCharactersInString:
        @"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"] invertedSet];
    return [channel rangeOfCharacterFromSet:invalid].location == NSNotFound;
}

static NSURL* EBValidatedChallengeURL(NSString* value, NSString* channel) {
    if (!EBValidChannel(channel)) return nil;
    NSURLComponents* parts = [NSURLComponents componentsWithString:value];
    if (parts == nil || ![[parts.scheme lowercaseString] isEqualToString:@"https"] ||
        parts.host.length == 0 || parts.user.length > 0 || parts.password.length > 0 ||
        ![parts.path isEqualToString:@"/api/captcha/challenge"] || parts.fragment.length > 0) {
        return nil;
    }
    NSString* boundChannel = nil;
    NSString* bridge = nil;
    for (NSURLQueryItem* item in parts.queryItems) {
        if ([item.name isEqualToString:@"channel"]) boundChannel = item.value;
        if ([item.name isEqualToString:@"bridge"]) bridge = item.value;
    }
    if (![boundChannel isEqualToString:channel] || ![bridge isEqualToString:@"unity"]) return nil;
    return parts.URL;
}

@implementation EBTurnstileRequest

- (instancetype)initWithGameObjectName:(NSString*)gameObjectName
                             requestId:(NSString*)requestId
                          challengeURL:(NSURL*)challengeURL
                               channel:(NSString*)channel {
    self = [super init];
    if (!self) return nil;
    _gameObjectName = [gameObjectName copy];
    _requestId = [requestId copy];
    _challengeURL = challengeURL;
    _channel = [channel copy];
    _terminal = NO;

    WKWebViewConfiguration* configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = WKWebsiteDataStore.defaultDataStore;
    NSString* bridgeScript = @"Object.defineProperty(window,'Unity',{value:{call:function(m){window.webkit.messageHandlers.edgebaseCaptcha.postMessage(m);}},configurable:false,writable:false});";
    WKUserScript* script = [[WKUserScript alloc]
        initWithSource:bridgeScript
        injectionTime:WKUserScriptInjectionTimeAtDocumentStart
        forMainFrameOnly:YES];
    [configuration.userContentController addUserScript:script];
    [configuration.userContentController addScriptMessageHandler:self name:@"edgebaseCaptcha"];

    _webView = [[WKWebView alloc] initWithFrame:CGRectZero configuration:configuration];
    _webView.navigationDelegate = self;
    _webView.opaque = NO;
    _webView.backgroundColor = UIColor.clearColor;
    _webView.scrollView.scrollEnabled = NO;

    UIViewController* rootController = EBRootViewController();
    if (rootController == nil) return self;
    _overlayView = [[UIView alloc] initWithFrame:rootController.view.bounds];
    _overlayView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    _overlayView.backgroundColor = UIColor.clearColor;
    _overlayView.userInteractionEnabled = NO;

    CGRect bounds = _overlayView.bounds;
    CGFloat width = MIN(CGRectGetWidth(bounds) - 36.0, 420.0);
    CGRect cardFrame = CGRectMake(
        (CGRectGetWidth(bounds) - width) * 0.5,
        (CGRectGetHeight(bounds) - 340.0) * 0.5,
        width,
        340.0
    );
    _cardView = [[UIView alloc] initWithFrame:cardFrame];
    _cardView.autoresizingMask = UIViewAutoresizingFlexibleLeftMargin |
        UIViewAutoresizingFlexibleRightMargin | UIViewAutoresizingFlexibleTopMargin |
        UIViewAutoresizingFlexibleBottomMargin;
    _cardView.backgroundColor = UIColor.whiteColor;
    _cardView.layer.cornerRadius = 18.0;
    _cardView.layer.masksToBounds = YES;
    _cardView.alpha = 0.0;
    _webView.frame = _cardView.bounds;
    _webView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [_cardView addSubview:_webView];
    [_overlayView addSubview:_cardView];
    [rootController.view addSubview:_overlayView];

    NSURLRequest* request = [NSURLRequest requestWithURL:challengeURL
        cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
        timeoutInterval:30.0];
    [_webView loadRequest:request];
    return self;
}

- (void)showInteractiveOverlay {
    self.overlayView.userInteractionEnabled = YES;
    self.overlayView.backgroundColor = [[UIColor colorWithRed:7.0 / 255.0
        green:10.0 / 255.0 blue:16.0 / 255.0 alpha:1.0] colorWithAlphaComponent:0.62];
    self.cardView.alpha = 1.0;
}

- (void)hideInteractiveOverlay {
    self.overlayView.userInteractionEnabled = NO;
    self.overlayView.backgroundColor = UIColor.clearColor;
    self.cardView.alpha = 0.0;
}

- (void)finishWithType:(NSString*)type value:(NSString*)value {
    if (self.terminal) return;
    self.terminal = YES;
    EBSendUnityMessage(self.gameObjectName, self.requestId, type, value);
    [self.webView stopLoading];
    self.webView.navigationDelegate = nil;
    [self.webView.configuration.userContentController removeScriptMessageHandlerForName:@"edgebaseCaptcha"];
    [self.webView removeFromSuperview];
    [self.cardView removeFromSuperview];
    [self.overlayView removeFromSuperview];
    [gEBTurnstileRequests removeObjectForKey:self.requestId];
}

- (void)userContentController:(WKUserContentController*)userContentController
      didReceiveScriptMessage:(WKScriptMessage*)message {
    if (![message.name isEqualToString:@"edgebaseCaptcha"] || !message.frameInfo.isMainFrame) return;
    WKSecurityOrigin* origin = message.frameInfo.securityOrigin;
    NSInteger expectedPort = self.challengeURL.port != nil ? self.challengeURL.port.integerValue : 0;
    if (![[origin.protocol lowercaseString] isEqualToString:self.challengeURL.scheme.lowercaseString] ||
        ![[origin.host lowercaseString] isEqualToString:self.challengeURL.host.lowercaseString] ||
        origin.port != expectedPort) {
        [self finishWithType:@"error" value:@"origin-mismatch"];
        return;
    }
    if (![message.body isKindOfClass:[NSString class]]) return;
    NSString* raw = (NSString*)message.body;
    NSData* data = [raw dataUsingEncoding:NSUTF8StringEncoding];
    if (data.length == 0 || data.length > 4096) return;
    NSDictionary* payload = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![payload isKindOfClass:[NSDictionary class]] || [payload[@"v"] integerValue] != 1 ||
        ![payload[@"channel"] isEqualToString:self.channel]) return;
    NSString* type = [payload[@"type"] isKindOfClass:[NSString class]] ? payload[@"type"] : @"";
    NSString* value = [payload[@"value"] isKindOfClass:[NSString class]] ? payload[@"value"] : @"";
    if ([type isEqualToString:@"token"]) {
        if (value.length == 0 || value.length > 2048) [self finishWithType:@"error" value:@"invalid-token"];
        else [self finishWithType:@"token" value:value];
    } else if ([type isEqualToString:@"error"]) {
        [self finishWithType:@"error" value:[value substringToIndex:MIN(value.length, 256)]];
    } else if ([type isEqualToString:@"interactive"]) {
        if ([value isEqualToString:@"show"]) [self showInteractiveOverlay];
        else if ([value isEqualToString:@"hide"]) [self hideInteractiveOverlay];
    }
}

- (void)webView:(WKWebView*)webView
decidePolicyForNavigationAction:(WKNavigationAction*)navigationAction
decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    BOOL mainFrame = navigationAction.targetFrame == nil || navigationAction.targetFrame.isMainFrame;
    NSURL* url = navigationAction.request.URL;
    if (mainFrame && ![url.absoluteString isEqualToString:self.challengeURL.absoluteString]) {
        [self finishWithType:@"error" value:@"navigation-blocked"];
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

- (void)webView:(WKWebView*)webView
decidePolicyForNavigationResponse:(WKNavigationResponse*)navigationResponse
decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
    if (navigationResponse.isForMainFrame &&
        [navigationResponse.response isKindOfClass:[NSHTTPURLResponse class]] &&
        ((NSHTTPURLResponse*)navigationResponse.response).statusCode >= 400) {
        [self finishWithType:@"error" value:@"http-error"];
        decisionHandler(WKNavigationResponsePolicyCancel);
        return;
    }
    decisionHandler(WKNavigationResponsePolicyAllow);
}

- (void)webView:(WKWebView*)webView didFailNavigation:(WKNavigation*)navigation withError:(NSError*)error {
    [self finishWithType:@"error" value:@"load-failed"];
}

- (void)webView:(WKWebView*)webView didFailProvisionalNavigation:(WKNavigation*)navigation withError:(NSError*)error {
    [self finishWithType:@"error" value:@"load-failed"];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView*)webView {
    [self finishWithType:@"error" value:@"renderer-terminated"];
}

@end

extern "C" void EB_Turnstile_RequestToken(
    const char* gameObjectName,
    const char* requestId,
    const char* challengeURL,
    const char* channel
) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (gEBTurnstileRequests == nil) gEBTurnstileRequests = [[NSMutableDictionary alloc] init];
        NSString* objectName = gameObjectName ? [NSString stringWithUTF8String:gameObjectName] : @"";
        NSString* request = requestId ? [NSString stringWithUTF8String:requestId] : @"";
        NSString* urlValue = challengeURL ? [NSString stringWithUTF8String:challengeURL] : @"";
        NSString* channelValue = channel ? [NSString stringWithUTF8String:channel] : @"";
        NSURL* validatedURL = EBValidatedChallengeURL(urlValue, channelValue);
        if (validatedURL == nil) {
            EBSendUnityMessage(objectName, request, @"error", @"invalid-challenge-url");
            return;
        }
        EBTurnstileRequest* existing = gEBTurnstileRequests[request];
        if (existing != nil) [existing finishWithType:@"error" value:@"cancelled"];
        EBTurnstileRequest* next = [[EBTurnstileRequest alloc]
            initWithGameObjectName:objectName
            requestId:request
            challengeURL:validatedURL
            channel:channelValue];
        if (next.overlayView == nil) {
            EBSendUnityMessage(objectName, request, @"error", @"ios-view-unavailable");
            return;
        }
        gEBTurnstileRequests[request] = next;
    });
}

extern "C" void EB_Turnstile_CancelTokenRequest(const char* requestId) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (gEBTurnstileRequests == nil || requestId == nullptr) return;
        NSString* request = [NSString stringWithUTF8String:requestId];
        EBTurnstileRequest* existing = gEBTurnstileRequests[request];
        if (existing != nil) [existing finishWithType:@"error" value:@"cancelled"];
    });
}
