// WKWebView spike: can a real WebKit browser pass golf.com.au's Cloudflare
// challenge, accept an interactive login, and keep the session across relaunch
// so a hidden webview could sync daily?
//
// Build+run: ./run.sh        (compile, bundle, launch)
// Watch stdout for: CHALLENGE / PAGE / BLOCKED / PROBE / AUTH lines.
// Log in manually in the window, then quit (Cmd-Q or close). Relaunch to test
// session persistence — PROBE GetSelf 200 on cold start = PASS.

import Cocoa
import WebKit

final class Spike: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var probed = false

    func applicationDidFinishLaunching(_ n: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // persistent -> survives relaunch
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1024, height: 768),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered, defer: false)
        window.title = "WKWebView spike — golf.com.au"
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        print("LAUNCH \(ProcessInfo.processInfo.operatingSystemVersionString)")
        webView.load(URLRequest(url: URL(string: "https://golf.com.au/")!))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    func webView(_ w: WKWebView, didStartProvisionalNavigation n: WKNavigation!) {
        probed = false
        print("NAV -> \(w.url?.absoluteString ?? "?")")
    }

    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
        print("NAV_FAIL \(e.localizedDescription)")
    }

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        w.evaluateJavaScript("document.title + '|' + location.href + '|' + (document.body ? document.body.innerText.slice(0,300) : '')") { value, _ in
            guard let s = value as? String else { return }
            let parts = s.split(separator: "|", maxSplits: 2).map(String.init)
            let title = parts.first ?? ""
            let url = parts.count > 1 ? parts[1] : ""
            let body = parts.count > 2 ? parts[2].lowercased() : ""
            if title.localizedCaseInsensitiveContains("just a moment") || body.contains("verify you are human") {
                print("CHALLENGE \(title) — \(url)")
            } else if body.contains("sorry, you have been blocked") || title.localizedCaseInsensitiveContains("attention required") {
                print("BLOCKED \(title) — \(url)")
            } else {
                print("PAGE \(title) — \(url)")
                if !self.probed {
                    self.probed = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.probe(w) }
                }
            }
        }
    }

    // Call the site's own JSON API in page context — same endpoints the golf
    // connector uses. This is the "hidden webview sync" feasibility test.
    func probe(_ w: WKWebView) {
        let js = """
          const out = {};
          const h = { headers: { 'datatype': 'json', 'contenttype': 'application/json' }, credentials: 'same-origin' };
          try { const r = await fetch('/api/member/GetSelf', h); out.self = r.status + ' ' + (await r.text()).slice(0, 300); }
          catch (e) { out.self = 'ERR ' + e; }
          try { const r = await fetch('/api/Score/GetMemberHandicapIndex', { ...h, method: 'POST', body: '{}' }); out.handicap = r.status + ' ' + (await r.text()).slice(0, 300); }
          catch (e) { out.handicap = 'ERR ' + e; }
          return JSON.stringify(out);
        """
        w.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .failure(let error): print("PROBE_ERR \(error.localizedDescription)"); return
            case .success(let value): print("PROBE \(value ?? "nil")")
            if let s = value as? String, s.contains("\"self\":\"200") || s.contains("\"self\": \"200") {
                    print("AUTH YES — session is logged in")
                } else {
                    print("AUTH no — not logged in (log in manually in the window)")
                }
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Spike()
app.delegate = delegate
setvbuf(stdout, nil, _IOLBF, 0)
app.run()
