import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let menu = NSMenu()
let appMenu = NSMenu()
let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") == true
let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Desktop Workspace"
menu.addItem(withTitle: name, action: nil, keyEquivalent: "").submenu = appMenu
appMenu.addItem(withTitle: chinese ? "退出" + name : "Quit " + name, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
let edit = NSMenu()
menu.addItem(withTitle: chinese ? "编辑" : "Edit", action: nil, keyEquivalent: "").submenu = edit
for (en, zh, action, key) in [("Undo", "撤销", "undo:", "z"), ("Cut", "剪切", "cut:", "x"),
                               ("Copy", "复制", "copy:", "c"), ("Paste", "粘贴", "paste:", "v"),
                               ("Select All", "全选", "selectAll:", "a")] {
    edit.addItem(withTitle: chinese ? zh : en, action: Selector(action), keyEquivalent: key)
}
app.mainMenu = menu
let profile = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                          appropriateFor: nil, create: true)
    .appendingPathComponent("io.github.918822019.deepseek-chat", isDirectory: true)
let controller = WorkspaceApp(resources: Bundle.main.resourceURL!,
                              helperURL: Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/WorkspaceHost"),
                              profile: profile)
app.delegate = controller
withExtendedLifetime(controller) { app.run() }
