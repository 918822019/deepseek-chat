import AppKit
import Darwin
import WebKit

final class WorkspaceApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
    let resources: URL
    let helperURL: URL
    let profile: URL
    let service = HostProcess()
    private(set) var window: NSWindow!
    private(set) var web: WKWebView!
    private var entry: URL?
    private var choosing = false

    // The integration runner supplies a temporary WebKit context and operates the same native panel.
    var configureWeb: ((WKWebViewConfiguration) -> Void)?
    var configurePanel: ((NSOpenPanel) -> Void)?
    var loaded: ((WKWebView) -> Void)?
    var opened: ((URL, Bool) -> Void)?
    var onFailure: ((String) -> Void)?

    init(resources: URL, helperURL: URL, profile: URL) {
        self.resources = resources
        self.helperURL = helperURL
        self.profile = profile
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        configureWeb?(config)
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "workspace")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Desktop Workspace"
        window.minSize = NSSize(width: 420, height: 520)
        window.contentView = web
        window.isReleasedWhenClosed = false
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        service.ready = { [weak self] url in
            self?.entry = url
            self?.web.load(URLRequest(url: url))
        }
        service.failed = { [weak self] detail in self?.fail(detail) }
        do { try service.start(executable: helperURL, assets: resources.appendingPathComponent("dist"), profile: profile) }
        catch { fail(error.localizedDescription) }
    }

    private func fail(_ detail: String) {
        if let onFailure { onFailure(detail); return }
        let alert = NSAlert()
        alert.messageText = window.title
        alert.informativeText = detail
        alert.runModal()
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) { service.stop() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url == entry && action.targetFrame?.isMainFrame == true { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated, ["https", "http"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView.url == entry { loaded?(webView) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let entry, message.webView?.url == entry,
              message.frameInfo.request.url == entry,
              let body = message.body as? [String: Any], body["Type"] as? String == "task-workspace",
              let id = body["Id"] as? String, UUID(uuidString: id) != nil,
              let action = body["Action"] as? String else { replyHandler(nil, "Invalid workspace message"); return }
        let empty: [String: Any] = ["id": id, "channel": "task-workspace", "value": NSNull()]
        let error: [String: Any] = ["id": id, "channel": "task-workspace", "error": "failed"]
        if action == "select" {
            guard !choosing else { replyHandler(error, nil); return }
            choosing = true
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.allowsMultipleSelection = false
            panel.title = body["Locale"] as? String == "zh-CN" ? "选择任务资料所在的文件夹" : "Select a source folder"
            configurePanel?(panel)
            panel.beginSheetModal(for: window) { [weak self] response in
                guard let self else { replyHandler(error, nil); return }
                self.choosing = false
                guard response == .OK, let url = panel.url else { replyHandler(empty, nil); return }
                // Foundation can shorten /private/var back to /var, which is a symbolic link.
                // The shared file reader requires the physical path of the user-selected directory.
                guard let physical = url.withUnsafeFileSystemRepresentation({ name in
                    name.flatMap { realpath($0, nil) }
                }) else { replyHandler(error, nil); return }
                let path = FileManager.default.string(withFileSystemRepresentation: physical, length: strlen(physical))
                free(physical)
                self.service.send(["Id": id, "Action": "grant", "Path": path]) {
                    replyHandler($0 ?? error, nil)
                }
            }
            return
        }
        guard ["restore", "read", "save", "open", "reveal"].contains(action) else {
            replyHandler(error, nil); return
        }
        service.send(body) { [weak self] response in
            guard let response else { replyHandler(error, nil); return }
            guard response["error"] == nil, ["open", "reveal"].contains(action) else {
                replyHandler(response, nil); return
            }
            guard let self, let path = response["value"] as? String else { replyHandler(error, nil); return }
            let url = URL(fileURLWithPath: path)
            if action == "reveal" {
                NSWorkspace.shared.activateFileViewerSelecting([url])
                self.opened?(url, true)
                replyHandler(empty, nil)
            } else {
                self.openDocument(url) { success in
                    if success { self.opened?(url, false) }
                    replyHandler(success ? empty : error, nil)
                }
            }
        }
    }

    private func openDocument(_ url: URL, completion: @escaping (Bool) -> Void) {
        let workspace = NSWorkspace.shared
        guard let application = workspace.urlForApplication(toOpen: url)
                ?? workspace.urlForApplication(withBundleIdentifier: "com.apple.TextEdit") else {
            completion(false); return
        }
        workspace.open([url], withApplicationAt: application, configuration: NSWorkspace.OpenConfiguration()) {
            running, error in DispatchQueue.main.async { completion(running != nil && error == nil) }
        }
    }
}
