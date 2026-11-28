using System.Globalization;
using System.Net;
using Microsoft.Extensions.FileProviders;

internal static class AssetServer
{
    private static readonly HttpClient Nvidia = new(new HttpClientHandler {
        AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.All
    }) { BaseAddress = new Uri("https://integrate.api.nvidia.com"), Timeout = Timeout.InfiniteTimeSpan };

    internal static async Task<WebApplication> Start(string assets, string profile)
    {
        assets = Path.GetFullPath(assets);
        if (!File.Exists(Path.Combine(assets, "index.html"))) throw new FileNotFoundException("Missing app resources.");
        // The WebKit origin is also the key to IndexedDB and localStorage. Keep it across launches.
        var portFile = Path.Combine(profile, "origin-port");
        var port = File.Exists(portFile) ? int.Parse(File.ReadAllText(portFile), CultureInfo.InvariantCulture) : 0;
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions {
            Args = [], ContentRootPath = assets, WebRootPath = assets
        });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, port));
        var app = builder.Build();
        app.Use(async (ctx, next) => {
            if (ctx.Request.Host.Host != "127.0.0.1") { ctx.Response.StatusCode = 403; return; }
            ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
            ctx.Response.Headers["Content-Security-Policy"] =
                "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
                "img-src 'self' data: blob: https: http:; connect-src 'self' https: http:; media-src 'self' blob:; " +
                "base-uri 'none'; frame-ancestors 'none'";
            await next(ctx);
        });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(assets) });
        app.MapGet("/proxy/nvidia/v1/models", (RequestDelegate)Relay);
        app.MapPost("/proxy/nvidia/v1/chat/completions", (RequestDelegate)Relay);
        await app.StartAsync();
        if (port == 0)
        {
            var temp = portFile + "." + Guid.NewGuid().ToString("N");
            try
            {
                File.WriteAllText(temp, new Uri(app.Urls.Single()).Port.ToString(CultureInfo.InvariantCulture));
                File.Move(temp, portFile);
            }
            catch { await app.DisposeAsync(); throw; }
            finally { File.Delete(temp); }
        }
        return app;
    }

    private static async Task Relay(HttpContext ctx)
    {
        if (ctx.Request.Headers["X-Workspace-Relay"] != "1") { ctx.Response.StatusCode = 403; return; }
        var models = HttpMethods.IsGet(ctx.Request.Method);
        using var request = new HttpRequestMessage(models ? HttpMethod.Get : HttpMethod.Post,
            models ? "/v1/models" : "/v1/chat/completions");
        if (ctx.Request.Headers.TryGetValue("Authorization", out var auth))
            request.Headers.TryAddWithoutValidation("Authorization", auth.ToString());
        if (!models)
        {
            request.Content = new StreamContent(ctx.Request.Body);
            request.Content.Headers.ContentType = new("application/json");
            request.Headers.Accept.ParseAdd("text/event-stream");
        }
        try
        {
            using var response = await Nvidia.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ctx.RequestAborted);
            ctx.Response.StatusCode = (int)response.StatusCode;
            ctx.Response.ContentType = response.Content.Headers.ContentType?.ToString();
            await response.Content.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
        }
        catch (HttpRequestException) when (!ctx.Response.HasStarted) { ctx.Response.StatusCode = 502; }
    }
}
