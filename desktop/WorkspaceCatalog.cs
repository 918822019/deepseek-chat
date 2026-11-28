using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

internal sealed class WorkspaceCatalog
{
    private readonly string directory;

    internal WorkspaceCatalog(string profileDirectory)
    {
        directory = Path.Combine(profileDirectory, "TaskWorkspaces");
    }

    // The web client can reopen only a folder previously granted by the native picker.
    internal string Remember(string root)
    {
        using var sha = SHA256.Create();
        var canonical = Path.DirectorySeparatorChar == '\\' ? root.ToUpperInvariant() : root;
        var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(canonical));
        var id = BitConverter.ToString(hash, 0, 16).Replace("-", "").ToLowerInvariant();
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, id);
        var temp = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".tmp");
        if (File.Exists(path)) return id;
        try
        {
            File.WriteAllText(temp, root, new UTF8Encoding(false));
            try { File.Move(temp, path); }
            catch (IOException) when (File.Exists(path)) { }
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
        return id;
    }

    internal string Root(string? id)
    {
        if (!Guid.TryParseExact(id, "N", out var key)) throw new InvalidOperationException();
        return File.ReadAllText(Path.Combine(directory, key.ToString("N")), Encoding.UTF8);
    }
}
