// Pet the Cat - small macOS wrapper that lets the web app request trackpad haptics.
// STATUS: compiles on a GitHub macOS runner (CI). Never launched on a real Mac by the author; trackpad haptics are UNVERIFIED.
// Requires: macOS 12.3+ (WKPreferences.isElementFullscreenEnabled), internet access. Ad-hoc signed, not notarized.
// Build:   swiftc -O PetTheCat.swift -o PetTheCat && ./PetTheCat      (needs Xcode Command Line Tools)
// Self test (no window, no network): ./PetTheCat --selftest
// The page posts {kind: "tick" | "bump"} to window.webkit.messageHandlers.haptic.
// macOS only plays trackpad haptics while a finger is on the trackpad (Apple docs for perform(_:performanceTime:)).
import Cocoa
import WebKit

let allowedHost = "cat-pet-haptic.pages.dev"
let startURL = URL(string: "https://\(allowedHost)/")!

// Navigation policy as a pure function so --selftest can check it.
func navigationAllowed(_ url: URL?) -> Bool {
    guard let url = url else { return false }
    if url.absoluteString == "about:blank" { return true }
    return url.scheme == "https" && url.host == allowedHost
}

// Minimum gap between haptics: 25 ms for bumps, 50 ms for ticks. A backstop for the web gate (which also limits
// bumps to one per 120 ms); kept small so a throttled call is a short gap rather than a lost gesture.
struct HapticGate {
    var last: TimeInterval = -1000
    mutating func allow(kind: String, now: TimeInterval) -> Bool {
        let gap: TimeInterval = kind == "bump" ? 0.025 : 0.05
        if now - last < gap { return false }
        last = now
        return true
    }
}

// Restarts after a web content process crash: allowed while fewer than `limit` happened in the last `window` seconds,
// so a page that keeps crashing ends on the error page instead of reloading forever.
struct CrashLimiter {
    var times: [TimeInterval] = []
    let limit = 3
    let window: TimeInterval = 30
    mutating func allowRestart(now: TimeInterval) -> Bool {
        times = times.filter { now - $0 < window }
        if times.count >= limit { return false }
        times.append(now)
        return true
    }
}

// Message for a load error, or nil when the error is not a real failure (cancelled loads, e.g. we cancelled
// a navigation ourselves, or WebKit's "frame load interrupted" after a policy cancel).
func loadErrorMessage(domain: String, code: Int) -> String? {
    if domain == NSURLErrorDomain {
        switch code {
        case NSURLErrorCancelled: return nil
        case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorCannotFindHost,
             NSURLErrorCannotConnectToHost, NSURLErrorTimedOut, NSURLErrorDNSLookupFailed:
            return "인터넷 연결을 확인해 주세요."
        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
             NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid:
            return "보안 연결에 실패했어요. 잠시 뒤 다시 시도해 주세요."
        default: return "페이지를 열지 못했어요. (오류 \(domain) \(code))"
        }
    }
    if domain == "WebKitErrorDomain" && code == 102 { return nil }
    return "페이지를 열지 못했어요. (오류 \(domain) \(code))"
}

func htmlEscape(_ s: String) -> String {
    s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "'", with: "&#39;")
        .replacingOccurrences(of: "\"", with: "&quot;")
}

func errorPage(_ message: String) -> String {
    "<html><meta charset=utf-8><body style='font:16px -apple-system;text-align:center;padding:12vh 2em;color:#453327'>"
    + "<h2>고양이를 불러오지 못했어요</h2><p>\(message)</p>"
    + "<p><a href='https://\(allowedHost)/' style='font-size:18px'>다시 시도</a></p></body></html>"
}

if CommandLine.arguments.contains("--selftest") {
    var failures = 0
    func check(_ ok: Bool, _ name: String) { if !ok { failures += 1; print("FAIL: \(name)") } else { print("ok: \(name)") } }
    check(navigationAllowed(URL(string: "https://\(allowedHost)/")), "own host allowed")
    check(!navigationAllowed(URL(string: "https://evil.example/")), "other host blocked")
    check(!navigationAllowed(URL(string: "http://\(allowedHost)/")), "http blocked")
    check(!navigationAllowed(URL(string: "https://\(allowedHost).evil.example/")), "lookalike host blocked")
    check(!navigationAllowed(URL(string: "file:///etc/passwd")), "file blocked")
    check(!navigationAllowed(nil), "nil blocked")
    check(htmlEscape("<a href='x'>&\"") == "&lt;a href=&#39;x&#39;&gt;&amp;&quot;", "html escape")
    check(loadErrorMessage(domain: NSURLErrorDomain, code: NSURLErrorCancelled) == nil, "cancelled load ignored")
    check(loadErrorMessage(domain: "WebKitErrorDomain", code: 102) == nil, "frame load interrupted ignored")
    check(loadErrorMessage(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)?.contains("인터넷") == true, "offline message")
    check(loadErrorMessage(domain: NSURLErrorDomain, code: NSURLErrorServerCertificateUntrusted)?.contains("보안") == true, "tls message")
    check(loadErrorMessage(domain: NSURLErrorDomain, code: NSURLErrorBadServerResponse)?.contains("인터넷") == false, "other error is not labelled as network")
    check(loadErrorMessage(domain: "SomeOtherDomain", code: -999) != nil, "-999 in another domain is not ignored")
    var c = CrashLimiter()
    check(c.allowRestart(now: 0) && c.allowRestart(now: 1) && c.allowRestart(now: 2), "three restarts allowed")
    check(!c.allowRestart(now: 3), "fourth restart within 30s refused")
    check(c.allowRestart(now: 40), "restart allowed again after 30s")
    var g = HapticGate()
    check(g.allow(kind: "tick", now: 10.000), "first tick")
    check(!g.allow(kind: "tick", now: 10.030), "tick within 50ms")
    check(g.allow(kind: "bump", now: 10.030), "bump 30ms after tick")
    check(g.allow(kind: "tick", now: 10.090), "tick after gap")
    exit(failures == 0 ? 0 : 1)
}

final class AppController: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var gate = HapticGate()
    var web: WKWebView!
    var crashes = CrashLimiter()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "haptic")
        config.preferences.isElementFullscreenEnabled = true
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.load(URLRequest(url: startURL))

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Pet the Cat"
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)   // so Copy / Select All reach the page without a click first
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // Only the app's own host may load in the main frame; links elsewhere open in the default browser.
    // Subframes (embeds, captchas) may load https content: they cannot reach the haptic handler, which only
    // accepts the main frame.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAllowed(url) { decisionHandler(.allow); return }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if !isMainFrame, url.scheme == "https" || url.scheme == "about" { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        let external = url.scheme == "https" || url.scheme == "http" || url.scheme == "mailto"
        if navigationAction.navigationType == .linkActivated {
            if external { NSWorkspace.shared.open(url) }
        } else if isMainFrame, external {
            // A redirect or script navigation away from the app's host (e.g. a domain move or an access
            // challenge). Without this the window would stay blank, because the cancel is not reported as an error.
            webView.loadHTMLString(errorPage("이 페이지는 앱 안에서 열 수 없어요. (\(htmlEscape(url.host ?? url.scheme ?? "")))"),
                                   baseURL: nil)
        }
    }

    // Load failures: show a message with a retry link instead of an empty window.
    private func showError(_ webView: WKWebView, _ error: Error) {
        let e = error as NSError
        guard let message = loadErrorMessage(domain: e.domain, code: e.code) else { return }
        webView.loadHTMLString(errorPage(message), baseURL: nil)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError(webView, error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError(webView, error)
    }
    // The page's web process crashed. `reload()` does nothing if nothing had committed yet, so load the start URL;
    // after repeated crashes show the error page instead of looping.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if crashes.allowRestart(now: ProcessInfo.processInfo.systemUptime) {
            webView.load(URLRequest(url: startURL))
        } else {
            webView.loadHTMLString(errorPage("페이지가 계속 멈춰요. 잠시 뒤 다시 시도해 주세요."), baseURL: nil)
        }
    }

    @objc func reload() { web.load(URLRequest(url: startURL)) }

    // target="_blank" links: open in the default browser, never in a new in-app window.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // Accept haptic requests only from the main frame of the app's own origin, rate limited by `gate`.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "haptic",
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == allowedHost,
              let body = message.body as? [String: Any] else { return }
        guard NSApp.isActive, window.isKeyWindow else { return }
        let kind = (body["kind"] as? String) == "bump" ? "bump" : "tick"
        if !gate.allow(kind: kind, now: ProcessInfo.processInfo.systemUptime) { return }
        let performer = NSHapticFeedbackManager.defaultPerformer
        performer.perform(kind == "bump" ? .levelChange : .alignment, performanceTime: .now)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let mainMenu = NSMenu()
let appItem = NSMenuItem()
mainMenu.addItem(appItem)
let appMenu = NSMenu()
appMenu.addItem(NSMenuItem(title: "Quit Pet the Cat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
appItem.submenu = appMenu
let editItem = NSMenuItem(); mainMenu.addItem(editItem)
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
editItem.submenu = editMenu
let viewItem = NSMenuItem(); mainMenu.addItem(viewItem)
let viewMenu = NSMenu(title: "View")
let controller = AppController()
let reloadItem = NSMenuItem(title: "Reload", action: #selector(AppController.reload), keyEquivalent: "r")
reloadItem.target = controller
viewMenu.addItem(reloadItem)
viewItem.submenu = viewMenu
let winItem = NSMenuItem(); mainMenu.addItem(winItem)
let winMenu = NSMenu(title: "Window")
winMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
winMenu.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
winItem.submenu = winMenu
app.mainMenu = mainMenu
app.windowsMenu = winMenu
app.delegate = controller
app.run()
