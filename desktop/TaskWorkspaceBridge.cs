using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;

internal sealed class TaskWorkspaceBridge : IDisposable
{
    private const string Channel = "task-workspace";
    private readonly CoreWebView2 view;
    private readonly Func<string, string?> chooseFolder;
    private readonly Action<string, bool> openOutput;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private readonly WorkspaceCatalog catalog;
    private readonly Dictionary<string, TaskWorkspace> scanned = new Dictionary<string, TaskWorkspace>();
    private bool selecting;
    private bool disposed;

    internal TaskWorkspaceBridge(CoreWebView2 view, Func<string, string?> chooseFolder, Action<string, bool> openOutput)
    {
        this.view = view;
        this.chooseFolder = chooseFolder;
        this.openOutput = openOutput;
        catalog = new WorkspaceCatalog(view.Environment.UserDataFolder);
        view.WebMessageReceived += OnMessage;
    }

    private async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (disposed || args.Source != ChatWindow.IndexUrl) return;

        Request? request;
        try
        {
            request = json.Deserialize<Request>(args.WebMessageAsJson);
        }
        catch (Exception error) when (error is ArgumentException || error is InvalidOperationException)
        {
            return;
        }
        if (request is null || request.Type != Channel || !Guid.TryParseExact(request.Id, "D", out _)) return;

        var id = request.Id;
        var action = request.Action;
        try
        {
            if (action == "select")
            {
                Reply(new { id, channel = Channel, value = await Select(request.Locale) });
                return;
            }
            if (action == "restore")
            {
                var root = catalog.Root(request.WorkspaceId);
                Reply(new { id, channel = Channel, value = await Inspect(root) });
                return;
            }
            object? value;
            if (action == "read")
            {
                if (request.WorkspaceId is null || !scanned.TryGetValue(request.WorkspaceId, out var current))
                {
                    Reply(new { id, channel = Channel, error = "workspaceLost" });
                    return;
                }
                value = await Task.Run(() => current.Read(request.Name ?? ""), lifetime.Token);
            }
            else
            {
                var root = catalog.Root(request.WorkspaceId);
                if (!Guid.TryParseExact(request.TaskId, "D", out var taskId)) throw new InvalidOperationException();
                var title = request.Title ?? "";
                if (action == "save")
                    value = await Task.Run(() => TaskWorkspace.Save(root, taskId, title, request.Content ?? ""), lifetime.Token);
                else if (action == "open" || action == "reveal")
                {
                    openOutput(TaskWorkspace.ResolveOutput(root, taskId, title), action == "reveal");
                    value = null;
                }
                else throw new InvalidOperationException();
            }
            Reply(new { id, channel = Channel, value });
        }
        catch (TaskWorkspace.ReadFailure error)
        {
            Reply(new { id, channel = Channel, error = error.Code.ToString() });
        }
        catch (Exception)
        {
            Reply(new { id, channel = Channel, error = "failed" });
        }
    }

    private async Task<object?> Select(string? locale)
    {
        if (selecting) throw new InvalidOperationException();
        selecting = true;
        try
        {
            // Show the shell dialog after WebView2 has returned from its message callback.
            await Task.Yield();
            if (disposed) return null;
            var title = locale == "zh-CN" ? "选择任务资料所在的文件夹" : "Select the task's source folder";
            var path = chooseFolder(title);
            if (path is null || disposed) return null;
            return await Inspect(path);
        }
        finally
        {
            selecting = false;
        }
    }

    private async Task<object> Inspect(string path)
    {
        var cancellation = lifetime.Token;
        var selected = await Task.Run(() => TaskWorkspace.Scan(path, cancellation), cancellation);
        cancellation.ThrowIfCancellationRequested();
        var key = catalog.Remember(selected.Root);
        scanned[key] = selected;
        return new { id = key, path = selected.Root, files = selected.Sources, limited = selected.Limited, skipped = selected.Skipped, inputLimit = TaskWorkspace.InputLimit };
    }

    private void Reply(object message)
    {
        if (!disposed) view.PostWebMessageAsJson(json.Serialize(message));
    }

    public void Dispose()
    {
        disposed = true;
        view.WebMessageReceived -= OnMessage;
        lifetime.Cancel();
        lifetime.Dispose();
    }

    public sealed class Request
    {
        public string? Id { get; set; }
        public string? Type { get; set; }
        public string? Action { get; set; }
        public string? WorkspaceId { get; set; }
        public string? Locale { get; set; }
        public string? Name { get; set; }
        public string? Content { get; set; }
        public string? TaskId { get; set; }
        public string? Title { get; set; }
    }
}
