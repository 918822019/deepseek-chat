using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

internal static class Program
{
    // The parent owns both ends of these pipes. HTTP only serves bundled assets and the model relay.
    public static async Task<int> Main(string[] args)
    {
        if (args.Length != 2) return 2;
        try
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            Directory.CreateDirectory(args[1]);
            var files = new WorkspaceCommands(args[1]);
            await using var server = await AssetServer.Start(args[0], args[1]);
            Send(new JsonObject { ["origin"] = server.Urls.Single().TrimEnd('/') });
            while (await Console.In.ReadLineAsync() is { } line)
            {
                if (line.Length > 4 * 1024 * 1024) continue;
                using var request = JsonDocument.Parse(line);
                var command = request.RootElement;
                var id = command.GetProperty("Id").GetString();
                if (!Guid.TryParseExact(id, "D", out _)) continue;
                var reply = new JsonObject { ["id"] = id, ["channel"] = "task-workspace" };
                try
                {
                    reply["value"] = files.Run(command);
                }
                catch (TaskWorkspace.ReadFailure error) { reply["error"] = error.Code.ToString(); }
                catch (Exception error)
                {
                    Console.Error.WriteLine($"Workspace {command.GetProperty("Action").GetString()}: {error.GetType().Name}");
                    reply["error"] = "failed";
                }
                Send(reply);
            }
            await server.StopAsync();
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static void Send(JsonObject message)
    {
        Console.WriteLine(JsonSerializer.Serialize(message, WireJson.Default.JsonObject));
        Console.Out.Flush();
    }
}

[JsonSerializable(typeof(JsonObject))]
internal partial class WireJson : JsonSerializerContext { }

internal sealed class WorkspaceCommands(string profile)
{
    private readonly WorkspaceCatalog catalog = new(profile);
    private readonly Dictionary<string, TaskWorkspace> scanned = new();

    public JsonNode? Run(JsonElement command)
    {
        string Arg(string key) => command.GetProperty(key).GetString() ?? throw new InvalidDataException();
        var action = Arg("Action");
        if (action is "grant" or "restore")
        {
            // Only the native NSOpenPanel handler can issue a grant.
            var root = action == "grant" ? Arg("Path") : catalog.Root(Arg("WorkspaceId"));
            var workspace = TaskWorkspace.Scan(root, CancellationToken.None);
            var id = catalog.Remember(workspace.Root);
            scanned[id] = workspace;
            var list = new JsonArray();
            foreach (var source in workspace.Sources)
                list.Add(new JsonObject { ["name"] = source.name, ["bytes"] = source.bytes });
            return new JsonObject { ["id"] = id, ["path"] = workspace.Root, ["files"] = list,
                ["limited"] = workspace.Limited, ["skipped"] = workspace.Skipped, ["inputLimit"] = TaskWorkspace.InputLimit };
        }
        var workspaceId = Arg("WorkspaceId");
        if (action == "read")
        {
            if (!scanned.TryGetValue(workspaceId, out var workspace)) throw new InvalidDataException();
            var source = workspace.Read(Arg("Name"));
            return new JsonObject { ["content"] = source.content, ["bytes"] = source.bytes };
        }
        var directory = catalog.Root(workspaceId);
        var task = Guid.ParseExact(Arg("TaskId"), "D");
        var title = Arg("Title");
        if (action == "save")
        {
            var document = TaskWorkspace.Save(directory, task, title, Arg("Content"));
            return new JsonObject { ["name"] = document.name, ["path"] = document.path };
        }
        if (action is "open" or "reveal")
            return JsonValue.Create(TaskWorkspace.ResolveOutput(directory, task, title));
        throw new InvalidDataException();
    }
}
