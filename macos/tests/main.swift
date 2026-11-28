import AppKit
import WebKit

func fail(_ detail: String) -> Never {
    FileHandle.standardError.write(Data(("Workspace check failed: " + detail + "\n").utf8))
    exit(1)
}
let args = CommandLine.arguments
guard args.count == 6 else { fail("Expected bundle, profile, input folder, model URL and UI script") }
let bundle = URL(fileURLWithPath: args[1])
let profile = URL(fileURLWithPath: args[2])
let folder = URL(fileURLWithPath: args[3], isDirectory: true).resolvingSymlinksInPath()
let script = try String(contentsOfFile: args[5], encoding: .utf8)
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let shell = WorkspaceApp(resources: bundle.appendingPathComponent("Contents/Resources"),
                         helperURL: bundle.appendingPathComponent("Contents/Helpers/WorkspaceHost"), profile: profile)
shell.onFailure = { fail($0) }
shell.configureWeb = { config in
    config.websiteDataStore = .nonPersistent()
    let setup = """
    localStorage.setItem('chat-demo:locale','zh-CN');
    localStorage.setItem('chat-demo:provider','custom');
    localStorage.setItem('chat-demo:provider-base-url','\(args[4])');
    localStorage.setItem('chat-demo:provider-model','workspace-ci');
    localStorage.setItem('chat-demo:api-key:custom','local-test-only');
    """
    config.userContentController.addUserScript(WKUserScript(source: setup, injectionTime: .atDocumentStart, forMainFrameOnly: true))
}
shell.configurePanel = { panel in
    panel.directoryURL = folder
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { panel.ok(nil) }
}
var opened = Set<String>()
var finished = false
func checkCompletion() {
    guard finished, opened == ["open", "reveal"] else { return }
    print("PASS native folder panel, Word and Excel, model stream, preview, native open and Finder reveal")
    shell.service.stop()
    NSApp.terminate(nil)
}
shell.opened = { url, reveal in
    guard url.pathExtension == "md", url.deletingLastPathComponent().lastPathComponent == "工作台成果",
          url.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL.path == folder.standardizedFileURL.path,
          (try? String(contentsOf: url, encoding: .utf8))?.contains("7350") == true else { fail("Unexpected artifact \(url)") }
    opened.insert(reveal ? "reveal" : "open")
    checkCompletion()
}
shell.loaded = { web in
    print("Loaded WKWebView on Apple silicon")
    web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
        switch result {
        case .success: finished = true; checkCompletion()
        case .failure(let error): fail("\((error as NSError).userInfo)")
        }
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 85) { fail("Timed out. Completed native actions: \(opened)") }
app.delegate = shell
withExtendedLifetime(shell) { app.run() }
