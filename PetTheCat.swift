// Pet the Cat - small macOS wrapper that lets the web app request trackpad haptics.
// STATUS: NOT COMPILED AND NOT TESTED ON A MAC. Written without a Swift compiler.
// Requires: macOS 12.3+ (WKPreferences.isElementFullscreenEnabled), Xcode Command Line Tools, internet access.
// Build:   swiftc -O PetTheCat.swift -o PetTheCat && ./PetTheCat
//          (the binary is unsigned; building and running it locally from Terminal is expected to work)
// The page posts {kind: "tick" | "bump"} to window.webkit.messageHandlers.haptic.
// macOS only plays trackpad haptics while a finger is on the trackpad (Apple docs for perform(_:performanceTime:)).
import Cocoa
import WebKit

let allowedHost = "cat-pet-haptic.pages.dev"
let startURL = URL(string: "https://\(allowedHost)/")!

final class AppController: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var lastHaptic: TimeInterval = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "haptic")
        config.preferences.isElementFullscreenEnabled = true
        let web = WKWebView(frame: .zero, configuration: config)
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
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // Only the app's own host may navigate inside this window; everything else opens in the default browser.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" { decisionHandler(.allow); return }
        if url.scheme == "https", url.host == allowedHost { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, url.scheme == "https" || url.scheme == "http" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    // target="_blank" links: open in the default browser, never in a new in-app window.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // Accept haptic requests only from the main frame of the app's own origin, at most ~16 per second.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "haptic",
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == allowedHost,
              let body = message.body as? [String: Any] else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastHaptic < 0.06 { return }
        lastHaptic = now
        let performer = NSHapticFeedbackManager.defaultPerformer
        switch body["kind"] as? String {
        case "bump": performer.perform(.levelChange, performanceTime: .now)
        default: performer.perform(.alignment, performanceTime: .now)
        }
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
app.mainMenu = mainMenu
let controller = AppController()
app.delegate = controller
app.run()
