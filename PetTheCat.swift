// Pet the Cat - small macOS wrapper that lets the web app request trackpad haptics.
// STATUS: compiles on a GitHub macOS runner (CI). Never launched on a real Mac by the author; trackpad haptics are UNVERIFIED.
// Requires: macOS 12.3+ (WKPreferences.isElementFullscreenEnabled), internet access. Release builds are notarized only when CI has
//           the signing secrets (see README); otherwise ad-hoc signed.
// Build:   ./build.sh  (universal app bundle in build/), or
//          swiftc -O PetTheCat.swift -o PetTheCat && ./PetTheCat      (needs Xcode Command Line Tools)
// Self test (no window, no network): ./PetTheCat --selftest
// Smoke test (opens the window, loads the live page, prints what it found, quits; plays no haptics):
//          ./PetTheCat --smoke-test
// The page posts to window.webkit.messageHandlers.haptic:
//   {kind: "zone", zone: "body" | "tail" | "none"}  what the pointer is over; the app then makes the fur texture
//                                                    itself from native pointer movement (see FurTexture)
//   {kind: "tick" | "bump"}                          one pulse (keyboard petting, buttons, and pages that predate
//                                                    "zone", which drive every pulse this way)
// The app announces the native texture to the page as window.petTheCatNative = {texture: 1}.
// macOS only plays trackpad haptics while a finger is on the trackpad (Apple docs for perform(_:performanceTime:)).
import Cocoa
import Darwin
import WebKit

let allowedHost = "cat-pet-haptic.pages.dev"
let smokeTest = CommandLine.arguments.contains("--smoke-test")
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

// MARK: - Trackpad haptics
//
// Apple's public API (NSHapticFeedbackManager) has three fixed patterns and no intensity, which feels like clicks
// rather than fur. Force Touch trackpads also accept the weaker single pulses that MultitouchSupport plays
// (private framework, resolved at runtime; the same approach as the open-source HapticKey, MIT, and WhichSpace, MIT).
// A texture is made the way surface-haptics research does it: one short pulse per distance travelled, spacing
// jittered so it does not feel like a ratchet, no pulse when the hand is (nearly) still, a minimum gap between
// pulses, and pulses dropped rather than queued. If the private framework is missing, it falls back to the public API.

enum HapticStyle: String, CaseIterable {
    case off, soft, normal, firm, system
    var title: String {
        switch self {
        case .off: return "Off"
        case .soft: return "Soft fur"
        case .normal: return "Fur"
        case .firm: return "Firm fur"
        case .system: return "System clicks (classic)"
        }
    }
    // Actuation IDs: single pulses of 5-7 ms that differ only in amplitude (table in MultitouchSupport's
    // __tpad_act_plist): 1 and 3 weakest, 5 light, 2 and 4 medium, 6 firm.
    var grainID: Int32 { self == .firm ? 5 : 1 }
    var clumpID: Int32 { switch self { case .soft: return 1; case .firm: return 2; default: return 5 } }
    var tailID: Int32 { switch self { case .soft: return 1; case .firm: return 2; default: return 5 } }
    var bumpID: Int32 { self == .soft ? 5 : 6 }
    /// Points of pointer travel per pulse. The public-API fallback is coarser: its pulses cannot be made weaker.
    var spacing: Double { switch self { case .soft: return 11; case .firm: return 7; case .system: return 18; default: return 8 } }
}

/// Decides when the pointer has travelled far enough, fast enough, for the next pulse. Pure, for --selftest.
struct GrainGenerator {
    var spacing: Double
    var jitter = 0.35            // +/- fraction of spacing
    var minInterval = 0.018      // s between pulses; a pulse that would come sooner is dropped
    var minSpeed = 40.0          // pt/s; slower than this is a resting hand: no pulse
    private var travelled = 0.0
    private var next: Double
    private var lastEvent: Double?
    private var speed = 0.0
    private var lastPulse = -1000.0
    init(spacing: Double) { self.spacing = spacing; next = spacing }
    /// `random` in -1...1 jitters the spacing of the following grain.
    mutating func move(distance: Double, at t: Double, random: Double) -> Bool {
        if let last = lastEvent { speed = speed * 0.6 + (distance / max(t - last, 0.001)) * 0.4 }
        else { speed = distance / 0.008 }   // first event after a reset: assume a typical ~8 ms event interval
        lastEvent = t
        travelled += distance
        guard travelled >= next else { return false }
        travelled = 0
        next = spacing * (1 + jitter * max(-1, min(1, random)))
        guard t - lastPulse >= minInterval, speed >= minSpeed else { return false }
        lastPulse = t
        return true
    }
    mutating func reset() { travelled = 0; lastEvent = nil; speed = 0 }
}

/// The trackpad's actuator through MultitouchSupport. All calls run on one serial queue; at most two pulses wait.
/// `usable` turns false when no device could be opened or none accepted a pulse; the caller then uses the public
/// API, and devices are looked up again at most every 2 s.
final class TrackpadActuator {
    private typealias CreateListFn = @convention(c) () -> Unmanaged<CFArray>?
    private typealias GetDeviceIDFn = @convention(c) (UnsafeRawPointer, UnsafeMutablePointer<UInt64>) -> Int32
    private typealias CreateFromIDFn = @convention(c) (UInt64) -> Unmanaged<CFTypeRef>?
    private typealias OpenCloseFn = @convention(c) (CFTypeRef) -> Int32
    private typealias ActuateFn = @convention(c) (CFTypeRef, Int32, UInt32, Float, Float) -> Int32

    private var createList: CreateListFn?, getDeviceID: GetDeviceIDFn?, createFromID: CreateFromIDFn?
    private var open: OpenCloseFn?, close: OpenCloseFn?, actuateFn: ActuateFn?
    private var actuators: [CFTypeRef] = []
    private var opened = false
    private let queue = DispatchQueue(label: "petthecat.actuator", qos: .userInteractive)
    private let lock = NSLock()
    private var waiting = 0
    private var usableFlag = true
    private var lastOpenAttempt = -1000.0
    /// Whether the private framework and its functions were found. Pulses may still fail later (no trackpad).
    let available: Bool

    init() {
        let handle = dlopen("/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport", RTLD_NOW)
        func sym<T>(_ name: String, _: T.Type) -> T? {
            guard let handle, let p = dlsym(handle, name) else { return nil }
            return unsafeBitCast(p, to: T.self)
        }
        createList = sym("MTDeviceCreateList", CreateListFn.self)
        getDeviceID = sym("MTDeviceGetDeviceID", GetDeviceIDFn.self)
        createFromID = sym("MTActuatorCreateFromDeviceID", CreateFromIDFn.self)
        open = sym("MTActuatorOpen", OpenCloseFn.self)
        close = sym("MTActuatorClose", OpenCloseFn.self)
        actuateFn = sym("MTActuatorActuate", ActuateFn.self)
        available = createList != nil && getDeviceID != nil && createFromID != nil && open != nil && actuateFn != nil
    }

    private func openAll() -> [CFTypeRef] {
        guard let createList, let getDeviceID, let createFromID, let open,
              let list = createList()?.takeRetainedValue() else { return [] }
        var result: [CFTypeRef] = []
        for i in 0..<CFArrayGetCount(list) {
            guard let device = CFArrayGetValueAtIndex(list, i) else { continue }
            var id: UInt64 = 0
            guard getDeviceID(device, &id) == 0, let actuator = createFromID(id)?.takeRetainedValue() else { continue }
            if open(actuator) == 0 { result.append(actuator) }
        }
        return result
    }

    var usable: Bool { lock.lock(); defer { lock.unlock() }; return available && usableFlag }
    private func setUsable(_ v: Bool) { lock.lock(); usableFlag = v; lock.unlock() }

    /// On the queue: open the devices if needed, at most every 2 s.
    private func ensureOpen() {
        guard !opened else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastOpenAttempt >= 2 else { return }
        lastOpenAttempt = now
        actuators = openAll()
        opened = !actuators.isEmpty
        setUsable(opened)
    }

    /// Plays one pulse on every open trackpad. Returns false when dropped because pulses are already waiting.
    @discardableResult
    func pulse(_ id: Int32) -> Bool {
        lock.lock()
        if waiting >= 2 { lock.unlock(); return false }
        waiting += 1
        lock.unlock()
        queue.async { [self] in
            defer { lock.lock(); waiting -= 1; lock.unlock() }
            ensureOpen()
            guard let actuateFn, opened else { return }
            // Keep the devices that took the pulse; close the ones that failed (e.g. stale after sleep/wake).
            var kept: [CFTypeRef] = []
            for a in actuators {
                if actuateFn(a, id, 0, 0, 0) == 0 { kept.append(a) } else { _ = close?(a) }
            }
            actuators = kept
            if kept.isEmpty { opened = false; setUsable(false) }
        }
        return true
    }

    /// While unusable: try to open the devices again (throttled), without playing anything.
    func retryIfDue() { guard available else { return }; queue.async { [self] in ensureOpen() } }
}

/// Fur texture made from native pointer movement while the page says the pointer is over the cat.
final class FurTexture {
    enum Zone: String { case none, body, tail }
    var zone: Zone = .none { didSet { if zone != oldValue { grains.reset() } } }
    var style: HapticStyle { didSet { grains = GrainGenerator(spacing: style.spacing); UserDefaults.standard.set(style.rawValue, forKey: "hapticStyle") } }
    private let actuator = TrackpadActuator()
    private var grains: GrainGenerator
    private var pageGate = HapticGate()
    private var fallbackLast = -1000.0
    private var count = 0
    /// Decides per event whether the window may play haptics (app active, our key window).
    var canPlay: (NSEvent?) -> Bool = { _ in true }

    init() {
        let saved = HapticStyle(rawValue: UserDefaults.standard.string(forKey: "hapticStyle") ?? "") ?? .normal
        style = saved
        grains = GrainGenerator(spacing: saved.spacing)
    }

    /// Native pointer movement (mouseMoved / dragged): the texture itself.
    func handle(_ e: NSEvent) {
        guard zone != .none, style != .off, canPlay(e) else { return }
        let d = Double(hypot(e.deltaX, e.deltaY))
        guard grains.move(distance: d, at: e.timestamp, random: Double.random(in: -1...1)) else { return }
        count += 1
        let id: Int32 = zone == .tail ? style.tailID : (count % 5 == 0 ? style.clumpID : style.grainID)
        play(id, fallback: .generic, now: e.timestamp)
    }

    /// One pulse requested by the page ("tick" / "bump"), rate limited like before.
    func pagePulse(_ kind: String) {
        guard style != .off, canPlay(nil) else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard pageGate.allow(kind: kind, now: now) else { return }
        if kind == "bump" { play(style.bumpID, fallback: .levelChange, now: now) }
        else { play(style.grainID, fallback: .alignment, now: now) }
    }

    /// Pulse times (s from start) and IDs for a steady stroke over the body: what the texture plays for a hand
    /// moving at `speed` pt/s, so it can be felt without moving. Pure, for --selftest.
    static func previewSchedule(style: HapticStyle, speed: Double, duration: Double, seed: UInt64 = 1) -> [(t: Double, id: Int32)] {
        var gen = GrainGenerator(spacing: style.spacing)
        var rng = seed
        var out: [(Double, Int32)] = []
        let step = 0.008
        var t = 0.0, n = 0
        while t < duration {
            rng = rng &* 6364136223846793005 &+ 1442695040888963407          // LCG: repeatable jitter
            let r = Double(rng >> 11) / Double(1 << 53) * 2 - 1
            if gen.move(distance: speed * step, at: t, random: r) {
                n += 1
                out.append((t, n % 5 == 0 ? style.clumpID : style.grainID))
            }
            t += step
        }
        return out
    }

    /// Plays the current texture as if stroking at a moderate speed for 1.2 s (finger on the trackpad).
    func preview() {
        guard style != .off else { return }
        for p in FurTexture.previewSchedule(style: style, speed: 300, duration: 1.2) {
            DispatchQueue.main.asyncAfter(deadline: .now() + p.t) { [self] in
                play(p.id, fallback: .generic, now: ProcessInfo.processInfo.systemUptime)
            }
        }
    }

    /// Plays actuation IDs 1...6 one after another, 0.6 s apart, to compare strengths.
    func compareStrengths() {
        for (i, id) in (1...6).enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6 * Double(i)) { [self] in
                if actuator.usable { actuator.pulse(Int32(id)) }
                else { NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now) }
            }
        }
    }

    private func play(_ id: Int32, fallback: NSHapticFeedbackManager.FeedbackPattern, now: Double) {
        if style != .system, actuator.usable { actuator.pulse(id); return }
        if style != .system { actuator.retryIfDue() }
        // Public API: fixed strength, so keep pulses at least 45 ms apart.
        guard now - fallbackLast >= 0.045 else { return }
        fallbackLast = now
        NSHapticFeedbackManager.defaultPerformer.perform(fallback, performanceTime: .now)
    }
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
    check(navigationAllowed(URL(string: "about:blank")), "about:blank allowed (the error page loads there)")
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
    do {
        var gen = GrainGenerator(spacing: 8)
        var fired: [Double] = []
        for i in 1...100 { let t = Double(i) * 0.01; if gen.move(distance: 1, at: t, random: 0) { fired.append(t) } }  // 100 pt/s
        check(fired.count >= 11 && fired.count <= 13, "grain every ~8 pt at 100 pt/s (\(fired.count) in 100 pt)")
        gen.reset()
        var slow = 0
        for i in 1...200 { if gen.move(distance: 0.2, at: 2 + Double(i) * 0.01, random: 0) { slow += 1 } }       // 20 pt/s
        check(slow == 0, "no grain for a resting hand (20 pt/s)")
        gen.reset()
        var fast: [Double] = []
        for i in 1...100 { let t = 5 + Double(i) * 0.004; if gen.move(distance: 12, at: t, random: 0) { fast.append(t) } } // 3000 pt/s
        let gaps = zip(fast.dropFirst(), fast).map { $0 - $1 }
        check(!fast.isEmpty && gaps.allSatisfy { $0 >= 0.018 - 1e-9 }, "fast strokes: pulses at least 18 ms apart")
        var jit = GrainGenerator(spacing: 8)
        var at: [Double] = [], dist = 0.0
        for i in 1...400 { dist += 0.5; if jit.move(distance: 0.5, at: Double(i) * 0.005, random: sin(Double(i) * 0.37)) { at.append(dist) } }
        let spacings = Set(zip(at.dropFirst(), at).map { $0 - $1 })
        check(spacings.count > 1, "jitter varies the spacing")
        let pv = FurTexture.previewSchedule(style: .normal, speed: 300, duration: 1.2)
        let pvGaps = zip(pv.dropFirst(), pv).map { $0.t - $1.t }
        check(pv.count >= 30 && pv.count <= 60 && pvGaps.allSatisfy { $0 >= 0.018 - 1e-9 },
              "preview: 30-60 grains in 1.2 s at 300 pt/s, >= 18 ms apart (\(pv.count))")
        check(pv.contains { $0.id == HapticStyle.normal.clumpID } && pv.contains { $0.id == HapticStyle.normal.grainID },
              "preview mixes grains and clumps")
        check(FurTexture.previewSchedule(style: .soft, speed: 300, duration: 1.2).count < pv.count, "soft is sparser than normal")
        var first = GrainGenerator(spacing: 8)
        check(first.move(distance: 10, at: 1, random: 0), "a fast first move after a reset is not swallowed")
        check(TrackpadActuator().available || true, "actuator lookup does not crash")
        for s in HapticStyle.allCases { check(s.spacing > 0 && s.grainID > 0, "style \(s.rawValue) has parameters") }
    }
    var g = HapticGate()
    check(g.allow(kind: "tick", now: 10.000), "first tick")
    check(!g.allow(kind: "tick", now: 10.030), "tick within 50ms")
    check(g.allow(kind: "bump", now: 10.030), "bump 30ms after tick")
    check(g.allow(kind: "tick", now: 10.090), "tick after gap")
    exit(failures == 0 ? 0 : 1)
}

final class AppController: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!
    var crashes = CrashLimiter()
    let texture = FurTexture()
    var styleItems: [NSMenuItem] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "haptic")
        config.userContentController.addUserScript(WKUserScript(
            source: "window.petTheCatNative = Object.freeze({ texture: 1 });",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.preferences.isElementFullscreenEnabled = true
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.load(URLRequest(url: startURL))

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Pet the Cat"
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("MainWindow")   // remembers size and position between launches
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)   // so Copy / Select All reach the page without a click first
        window.acceptsMouseMovedEvents = true

        texture.canPlay = { [weak self] e in
            guard let self, NSApp.isActive, self.window.isKeyWindow else { return false }
            return e == nil || e?.window === self.window
        }
        NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] e in
            self?.texture.handle(e)
            return e
        }
        updateStyleMenu()
        NSApp.activate(ignoringOtherApps: true)
        if smokeTest {
            DispatchQueue.main.asyncAfter(deadline: .now() + 45) { self.smokeExit(false, "timed out after 45 s") }
        }
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
        if smokeTest { smokeExit(false, message) }
        texture.zone = .none
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
    // A new page (or the error page) starts with the pointer over nothing until it reports otherwise.
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { texture.zone = .none }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard smokeTest else { return }
        guard webView.url?.host == allowedHost else { smokeExit(false, "loaded \(webView.url?.absoluteString ?? "nothing") instead of the app page"); return }
        // Let the page script run, then read what it built.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            let js = """
            JSON.stringify({ canvas: !!document.getElementById('c'), native: !!(window.petTheCatNative && window.petTheCatNative.texture),
              bridge: !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.haptic),
              status: (document.getElementById('status') || {}).textContent || '' })
            """
            webView.evaluateJavaScript(js) { result, error in
                guard let text = result as? String, let data = text.data(using: .utf8),
                      let info = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                    self.smokeExit(false, "page script failed: \(error.map { "\($0)" } ?? "no result")"); return
                }
                print("smoke: page \(text)")
                let ok = info["canvas"] as? Bool == true && info["native"] as? Bool == true && info["bridge"] as? Bool == true
                self.smokeExit(ok, ok ? "page loaded with the haptic bridge" : "page is missing the canvas or the bridge")
            }
        }
    }
    func smokeExit(_ ok: Bool, _ message: String) {
        print("smoke: \(ok ? "ok" : "FAIL"): \(message)")
        print("smoke: trackpad actuator \(TrackpadActuator().available ? "found" : "not found (public API fallback)")")
        exit(ok ? 0 : 1)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        texture.zone = .none
        if crashes.allowRestart(now: ProcessInfo.processInfo.systemUptime) {
            webView.load(URLRequest(url: startURL))
        } else {
            webView.loadHTMLString(errorPage("페이지가 계속 멈춰요. 잠시 뒤 다시 시도해 주세요."), baseURL: nil)
        }
    }

    @objc func reload() { texture.zone = .none; web.load(URLRequest(url: startURL)) }

    // target="_blank" links: open in the default browser, never in a new in-app window.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // Accept haptic messages only from the main frame of the app's own origin.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "haptic",
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == allowedHost,
              let body = message.body as? [String: Any] else { return }
        switch body["kind"] as? String {
        case "zone": texture.zone = FurTexture.Zone(rawValue: body["zone"] as? String ?? "") ?? .none
        case "bump": texture.pagePulse("bump")
        default: texture.pagePulse("tick")
        }
    }

    @objc func chooseStyle(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let style = HapticStyle(rawValue: raw) else { return }
        texture.style = style
        updateStyleMenu()
    }
    @objc func previewTexture() { texture.preview() }
    @objc func compareStrengths() { texture.compareStrengths() }
    func updateStyleMenu() { for item in styleItems { item.state = (item.representedObject as? String) == texture.style.rawValue ? .on : .off } }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let mainMenu = NSMenu()
let appItem = NSMenuItem()
mainMenu.addItem(appItem)
let appMenu = NSMenu()
appMenu.addItem(NSMenuItem(title: "About Pet the Cat", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
appMenu.addItem(.separator())
appMenu.addItem(NSMenuItem(title: "Hide Pet the Cat", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
hideOthers.keyEquivalentModifierMask = [.command, .option]
appMenu.addItem(hideOthers)
appMenu.addItem(NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
appMenu.addItem(.separator())
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
viewMenu.addItem(.separator())
let fullScreenItem = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
fullScreenItem.keyEquivalentModifierMask = [.command, .control]
viewMenu.addItem(fullScreenItem)
viewItem.submenu = viewMenu
let hapticsItem = NSMenuItem(); mainMenu.addItem(hapticsItem)
let hapticsMenu = NSMenu(title: "Haptics")
for style in HapticStyle.allCases {
    let item = NSMenuItem(title: style.title, action: #selector(AppController.chooseStyle(_:)), keyEquivalent: "")
    item.target = controller
    item.representedObject = style.rawValue
    hapticsMenu.addItem(item)
    controller.styleItems.append(item)
    if style == .off || style == .firm { hapticsMenu.addItem(.separator()) }
}
hapticsMenu.addItem(.separator())
let previewItem = NSMenuItem(title: "Preview Texture (finger on trackpad)", action: #selector(AppController.previewTexture), keyEquivalent: "")
previewItem.target = controller
hapticsMenu.addItem(previewItem)
let compareItem = NSMenuItem(title: "Compare Strengths 1–6", action: #selector(AppController.compareStrengths), keyEquivalent: "")
compareItem.target = controller
hapticsMenu.addItem(compareItem)
hapticsItem.submenu = hapticsMenu
let winItem = NSMenuItem(); mainMenu.addItem(winItem)
let winMenu = NSMenu(title: "Window")
winMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
winMenu.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
winItem.submenu = winMenu
app.mainMenu = mainMenu
app.windowsMenu = winMenu
app.delegate = controller
app.run()
