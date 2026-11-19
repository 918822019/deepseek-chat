using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;

internal sealed class NvidiaRelay : IDisposable
{
    private static readonly Uri Upstream = new Uri("https://integrate.api.nvidia.com");
    private readonly CoreWebView2 view;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    private readonly Dictionary<Guid, CancellationTokenSource> active = new Dictionary<Guid, CancellationTokenSource>();
    private readonly HttpClient http = new HttpClient(new HttpClientHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
    });
    private bool disposed;

    public NvidiaRelay(CoreWebView2 view)
    {
        this.view = view;
        view.WebMessageReceived += OnMessage;
    }

    private async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (disposed || args.Source != ChatWindow.IndexUrl) return;
        RequestMessage? message;
        try
        {
            message = json.Deserialize<RequestMessage>(args.WebMessageAsJson);
        }
        catch (ArgumentException)
        {
            return;
        }
        catch (InvalidOperationException)
        {
            return;
        }

        if (!Guid.TryParseExact(message?.Id, "D", out var id) || message is null) return;
        if (message.Type == "cancel")
        {
            if (active.TryGetValue(id, out var pending)) pending.Cancel();
            return;
        }
        if (message.Type != "request" || active.ContainsKey(id)) return;

        using var cancellation = new CancellationTokenSource();
        active.Add(id, cancellation);
        try
        {
            await Forward(message, cancellation.Token);
        }
        catch (Exception) when (cancellation.IsCancellationRequested)
        {
            // The request was canceled from the app or the window is closing.
        }
        catch (Exception)
        {
            Send(new { id = message.Id, type = "error", message = "Could not connect to NVIDIA NIM." });
        }
        finally
        {
            active.Remove(id);
        }
    }

    private async Task Forward(RequestMessage message, CancellationToken cancellation)
    {
        var id = message.Id;
        using var request = message.Route switch
        {
            "models" => new HttpRequestMessage(HttpMethod.Get, new Uri(Upstream, "/v1/models")),
            "chat" => new HttpRequestMessage(HttpMethod.Post, new Uri(Upstream, "/v1/chat/completions"))
            {
                Content = new StringContent(message.Body ?? "", Encoding.UTF8, "application/json"),
            },
            _ => throw new InvalidOperationException("Unknown NVIDIA route."),
        };
        var authorization = message.Authorization;
        if (authorization is not null && authorization.Length > 0
            && authorization.IndexOfAny(new[] { '\r', '\n' }) < 0)
        {
            request.Headers.TryAddWithoutValidation("Authorization", authorization);
        }
        if (message.Route == "chat") request.Headers.Accept.ParseAdd("text/event-stream");

        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
        var status = (int)response.StatusCode;
        if (status >= 300 && status < 400) throw new HttpRequestException("Unexpected NVIDIA redirect.");
        Send(new { id, type = "headers", status, contentType = response.Content.Headers.ContentType?.ToString() });
        if (status != 204 && status != 205)
        {
            using var stream = await response.Content.ReadAsStreamAsync();
            using var closeOnCancel = cancellation.Register(stream.Dispose);
            var buffer = new byte[8192];
            while (true)
            {
                var read = await stream.ReadAsync(buffer, 0, buffer.Length, cancellation);
                if (read == 0) break;
                Send(new { id, type = "chunk", data = Convert.ToBase64String(buffer, 0, read) });
            }
        }
        Send(new { id, type = "end" });
    }

    private void Send(object message)
    {
        if (!disposed) view.PostWebMessageAsJson(json.Serialize(message));
    }

    public void Dispose()
    {
        disposed = true;
        view.WebMessageReceived -= OnMessage;
        foreach (var request in new List<CancellationTokenSource>(active.Values)) request.Cancel();
        http.Dispose();
    }

    public sealed class RequestMessage
    {
        public string? Id { get; set; }
        public string? Type { get; set; }
        public string? Route { get; set; }
        public string? Authorization { get; set; }
        public string? Body { get; set; }
    }
}
