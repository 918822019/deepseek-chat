import Foundation

/// The helper writes one JSON reply per line. Reading and writing must not block the AppKit thread.
final class HostProcess {
    typealias Message = [String: Any]
    private let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let writer = DispatchQueue(label: "workspace.helper.input")
    private var replies = [String: (Message?) -> Void]()
    private var stopping = false
    var ready: ((URL) -> Void)?
    var failed: ((String) -> Void)?

    func start(executable: URL, assets: URL, profile: URL) throws {
        process.executableURL = executable
        process.arguments = [assets.path, profile.path]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.standardError
        try process.run()
        let reader = output.fileHandleForReading
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var buffer = Data()
            while true {
                let chunk = reader.availableData
                if chunk.isEmpty { break }
                buffer.append(chunk)
                while let end = buffer.firstIndex(of: 10) {
                    let line = buffer[..<end]
                    if let message = (try? JSONSerialization.jsonObject(with: line)) as? Message {
                        DispatchQueue.main.async { [weak self] in self?.receive(message) }
                    }
                    buffer.removeSubrange(...end)
                }
            }
            DispatchQueue.main.async { [weak self] in self?.closed() }
        }
    }

    func send(_ command: Message, reply: @escaping (Message?) -> Void) {
        guard process.isRunning, let id = command["Id"] as? String, replies[id] == nil,
              let json = try? JSONSerialization.data(withJSONObject: command) else { reply(nil); return }
        let data = json + Data([10])
        replies[id] = reply
        writer.async { [weak self] in
            do { try self?.input.fileHandleForWriting.write(contentsOf: data) }
            catch { DispatchQueue.main.async { [weak self] in self?.replies.removeValue(forKey: id)?(nil) } }
        }
    }

    private func receive(_ message: Message) {
        if let address = message["origin"] as? String, let url = URL(string: address),
           url.scheme == "http", url.host == "127.0.0.1", url.port != nil {
            ready?(url.appendingPathComponent("index.html"))
        } else if let id = message["id"] as? String {
            replies.removeValue(forKey: id)?(message)
        }
    }

    private func closed() {
        let pending = replies
        replies.removeAll()
        for reply in pending.values { reply(nil) }
        if !stopping {
            failed?(NSLocalizedString("The local workspace service stopped. Close other copies of the app and reopen it.", comment: ""))
        }
    }

    func stop() {
        stopping = true
        writer.async { [input] in try? input.fileHandleForWriting.close() }
    }
}
