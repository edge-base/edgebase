#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

extern "C" void UnitySendMessage(const char* obj, const char* method, const char* msg);

@interface EBTurnstileRequest : NSObject <WKNavigationDelegate>
@property(nonatomic, copy) NSString* gameObjectName;
@property(nonatomic, copy) NSString* requestId;
@property(nonatomic, strong) UIView* overlayView;
@property(nonatomic, strong) UIView* cardView;
@property(nonatomic, strong) WKWebView* webView;
- (instancetype)initWithGameObjectName:(NSString*)gameObjectName
                             requestId:(NSString*)requestId
                                  html:(NSString*)html;
- (void)showInteractiveOverlay;
- (void)hideInteractiveOverlay;
- (void)finishWithType:(NSString*)type value:(NSString*)value;
@end

static NSMutableDictionary<NSString*, EBTurnstileRequest*>* gEBTurnstileRequests;

static UIViewController* EBRootViewController(void) {
    UIWindow* keyWindow = nil;
    if (@available(iOS 13.0, *)) {
        for (UIScene* scene in UIApplication.sharedApplication.connectedScenes) {
            if (![scene isKindOfClass:[UIWindowScene class]]) {
                continue;
            }
            UIWindowScene* windowScene = (UIWindowScene*)scene;
            if (scene.activationState != UISceneActivationStateForegroundActive) {
                continue;
            }
            for (UIWindow* candidate in windowScene.windows) {
                if (candidate.isKeyWindow) {
                    keyWindow = candidate;
                    break;
                }
            }
            if (keyWindow != nil) {
                break;
            }
        }
    }

    if (keyWindow == nil) {
        keyWindow = UIApplication.sharedApplication.keyWindow;
    }

    UIViewController* controller = keyWindow.rootViewController;
    while (controller.presentedViewController != nil) {
        controller = controller.presentedViewController;
    }
    return controller;
}

static void EBSendUnityMessage(NSString* gameObjectName, NSString* requestId, NSString* type, NSString* value) {
    NSDictionary* payload = @{
        @"requestId": requestId ?: @"",
        @"type": type ?: @"",
        @"value": value ?: @""
    };
    NSData* data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    NSString* json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    UnitySendMessage(gameObjectName.UTF8String, "OnEdgeBaseCaptchaTokenMessage", json.UTF8String);
}

@implementation EBTurnstileRequest

- (instancetype)initWithGameObjectName:(NSString*)gameObjectName
                             requestId:(NSString*)requestId
                                  html:(NSString*)html {
    self = [super init];
    if (!self) {
        return nil;
    }

    _gameObjectName = [gameObjectName copy];
    _requestId = [requestId copy];

    WKWebViewConfiguration* configuration = [[WKWebViewConfiguration alloc] init];
    _webView = [[WKWebView alloc] initWithFrame:CGRectZero configuration:configuration];
    _webView.navigationDelegate = self;
    _webView.opaque = NO;
    _webView.backgroundColor = UIColor.clearColor;
    _webView.scrollView.scrollEnabled = NO;

    UIViewController* rootController = EBRootViewController();
    if (rootController == nil) {
        return self;
    }

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
    _cardView.autoresizingMask =
        UIViewAutoresizingFlexibleLeftMargin |
        UIViewAutoresizingFlexibleRightMargin |
        UIViewAutoresizingFlexibleTopMargin |
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

    [_webView loadHTMLString:html baseURL:[NSURL URLWithString:@"https://challenges.cloudflare.com"]];
    return self;
}

- (void)showInteractiveOverlay {
    self.overlayView.userInteractionEnabled = YES;
    self.overlayView.backgroundColor = [[UIColor colorWithRed:7.0 / 255.0 green:10.0 / 255.0 blue:16.0 / 255.0 alpha:1.0] colorWithAlphaComponent:0.62];
    self.cardView.alpha = 1.0;
}

- (void)hideInteractiveOverlay {
    self.overlayView.userInteractionEnabled = NO;
    self.overlayView.backgroundColor = UIColor.clearColor;
    self.cardView.alpha = 0.0;
}

- (void)finishWithType:(NSString*)type value:(NSString*)value {
    EBSendUnityMessage(self.gameObjectName, self.requestId, type, value);
    [self.webView stopLoading];
    self.webView.navigationDelegate = nil;
    [self.webView removeFromSuperview];
    [self.cardView removeFromSuperview];
    [self.overlayView removeFromSuperview];
    [gEBTurnstileRequests removeObjectForKey:self.requestId];
}

- (void)webView:(WKWebView*)webView
decidePolicyForNavigationAction:(WKNavigationAction*)navigationAction
decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL* url = navigationAction.request.URL;
    if (url != nil && [[url.scheme lowercaseString] isEqualToString:@"edgebase"]) {
        NSString* host = [[url.host ?: @"" lowercaseString] copy];
        NSString* value = url.path.length > 1 ? [[url.path substringFromIndex:1] stringByRemovingPercentEncoding] : @"";
        if (value == nil) {
            value = @"";
        }

        if ([host isEqualToString:@"token"]) {
            [self finishWithType:@"token" value:value];
        } else if ([host isEqualToString:@"error"]) {
            [self finishWithType:@"error" value:value];
        } else if ([host isEqualToString:@"interactive"]) {
            if ([value isEqualToString:@"show"]) {
                [self showInteractiveOverlay];
            } else if ([value isEqualToString:@"hide"]) {
                [self hideInteractiveOverlay];
            }
        }

        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }

    decisionHandler(WKNavigationActionPolicyAllow);
}

@end

extern "C" void EB_Turnstile_RequestToken(const char* gameObjectName, const char* requestId, const char* html) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (gEBTurnstileRequests == nil) {
            gEBTurnstileRequests = [[NSMutableDictionary alloc] init];
        }

        NSString* objectName = gameObjectName != nullptr ? [NSString stringWithUTF8String:gameObjectName] : @"";
        NSString* request = requestId != nullptr ? [NSString stringWithUTF8String:requestId] : @"";
        NSString* htmlString = html != nullptr ? [NSString stringWithUTF8String:html] : @"";

        EBTurnstileRequest* existing = gEBTurnstileRequests[request];
        if (existing != nil) {
            [existing finishWithType:@"error" value:@"cancelled"];
        }

        EBTurnstileRequest* next = [[EBTurnstileRequest alloc] initWithGameObjectName:objectName requestId:request html:htmlString];
        if (next.overlayView == nil) {
            EBSendUnityMessage(objectName, request, @"error", @"ios-view-unavailable");
            return;
        }

        gEBTurnstileRequests[request] = next;
    });
}

extern "C" void EB_Turnstile_CancelTokenRequest(const char* requestId) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (gEBTurnstileRequests == nil || requestId == nullptr) {
            return;
        }

        NSString* request = [NSString stringWithUTF8String:requestId];
        EBTurnstileRequest* existing = gEBTurnstileRequests[request];
        if (existing != nil) {
            [existing finishWithType:@"error" value:@"cancelled"];
        }
    });
}
