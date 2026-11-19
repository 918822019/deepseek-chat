using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ChatWindow());
    }
}

internal sealed class ChatWindow : Form
{
    private const string Host = "desktop.chat-demo.localhost";
    internal const string IndexUrl = "https://" + Host + "/index.html";
    private const string Csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        + "font-src 'self'; connect-src 'self' https: http:; img-src 'self' data: blob: https: http:; "
        + "media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'";

    private readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
    private NvidiaRelay? relay;

    public ChatWindow()
    {
        Text = "Chat Demo";
        Width = 1180;
        Height = 820;
        MinimumSize = new Size(420, 520);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Controls.Add(view);
    }

    protected override async void OnShown(EventArgs args)
    {
        base.OnShown(args);
        try
        {
            await InitializeView();
        }
        catch (Exception error)
        {
            if (IsDisposed) return;
            var message = error is WebView2RuntimeNotFoundException
                ? "缺少 Microsoft Edge WebView2 运行时。请重新运行 Chat Demo 安装程序。"
                : "无法启动 Chat Demo。\n\n" + error.Message;
            MessageBox.Show(this, message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async Task InitializeView()
    {
        var assets = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dist");
        var index = File.ReadAllBytes(Path.Combine(assets, "index.html"));
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var environment = await CoreWebView2Environment.CreateAsync(
            userDataFolder: Path.Combine(local, "Chat Demo WebView2", "Profile"));
        if (IsDisposed) return;
        await view.EnsureCoreWebView2Async(environment);
        if (IsDisposed) return;

        var core = view.CoreWebView2;
        Configure(core, interactiveApp: true);
        core.AddWebResourceRequestedFilter(IndexUrl, CoreWebView2WebResourceContext.Document,
            CoreWebView2WebResourceRequestSourceKinds.Document);
        core.WebResourceRequested += (_, args) =>
        {
            args.Response = environment.CreateWebResourceResponse(new MemoryStream(index, writable: false),
                200, "OK", "Content-Type: text/html; charset=utf-8\r\nContent-Security-Policy: " + Csp);
        };
        core.SetVirtualHostNameToFolderMapping(Host, assets, CoreWebView2HostResourceAccessKind.Deny);
        core.NavigationStarting += (_, args) =>
        {
            if (args.Uri == IndexUrl) return;
            args.Cancel = true;
            if (args.IsUserInitiated) OpenExternal(args.Uri);
        };
        core.FrameNavigationStarting += (_, args) => args.Cancel = true;
        core.NewWindowRequested += HandleNewWindow;
        relay = new NvidiaRelay(core);
        core.Navigate(IndexUrl);
    }

    private static void Configure(CoreWebView2 core, bool interactiveApp)
    {
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsWebMessageEnabled = interactiveApp;
        core.Settings.IsScriptEnabled = interactiveApp;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.PermissionRequested += (_, args) =>
        {
            if (interactiveApp && args.PermissionKind == CoreWebView2PermissionKind.Microphone
                && Uri.TryCreate(args.Uri, UriKind.Absolute, out var site)
                && site.Scheme == "https" && site.Host == Host && site.IsDefaultPort)
            {
                return;
            }
            args.State = CoreWebView2PermissionState.Deny;
        };
    }

    private async void HandleNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        args.Handled = true;
        if (!args.IsUserInitiated) return;
        if (!args.Uri.StartsWith("blob:https://" + Host + "/", StringComparison.Ordinal))
        {
            OpenExternal(args.Uri);
            return;
        }

        using (args.GetDeferral())
        {
            var preview = new Form { Text = "Chat Demo", Width = 900, Height = 650, Icon = Icon };
            var contents = new WebView2 { Dock = DockStyle.Fill };
            preview.Controls.Add(contents);
            try
            {
                preview.Show(this);
                await contents.EnsureCoreWebView2Async(view.CoreWebView2.Environment);
                var core = contents.CoreWebView2;
                Configure(core, interactiveApp: false);
                var address = args.Uri;
                core.NavigationStarting += (_, navigation) => navigation.Cancel = navigation.Uri != address;
                core.FrameNavigationStarting += (_, navigation) => navigation.Cancel = true;
                core.NewWindowRequested += (_, request) => request.Handled = true;
                args.NewWindow = core;
            }
            catch (Exception)
            {
                preview.Close();
            }
        }
    }

    private static void OpenExternal(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri)
            || (uri.Scheme != "https" && uri.Scheme != "http")) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // No system browser is associated with this URL.
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs args)
    {
        relay?.Dispose();
        base.OnFormClosed(args);
    }
}
