using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;

internal sealed class TaskWorkspace
{
    internal const int InputLimit = 1024 * 1024;
    private const int OfficeFileLimit = 16 * 1024 * 1024;
    private const int ScanLimit = 10000;
    private const int ListLimit = 300;
    internal const string OutputDirectory = "工作台成果";
    private const string OutputPrefix = "Chat-Demo-Task-";
    private const FileAttributes Excluded = FileAttributes.ReparsePoint | FileAttributes.Hidden | FileAttributes.System;
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    private static readonly HashSet<string> Extensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        ".txt", ".md", ".markdown", ".csv", ".tsv", ".json",
    };


    internal sealed class Source
    {
        public string name { get; }
        public int bytes { get; }

        internal Source(string name, int bytes)
        {
            this.name = name;
            this.bytes = bytes;
        }
    }

    internal enum ReadError { missing, tooLarge, encoding, format, empty, access, outputChanged }

    internal sealed class ReadFailure : Exception
    {
        internal ReadError Code { get; }

        internal ReadFailure(ReadError code)
        {
            Code = code;
        }
    }

    internal string Root { get; }
    internal bool Limited { get; }
    internal int Skipped { get; }
    internal IReadOnlyList<Source> Sources { get; }
    private readonly HashSet<string> names;

    private TaskWorkspace(string root, List<Source> sources, bool limited, int skipped)
    {
        Root = root;
        Sources = sources;
        Limited = limited;
        Skipped = skipped;
        names = new HashSet<string>(sources.Select(source => source.name), StringComparer.Ordinal);
    }

    internal static TaskWorkspace Scan(string directory, CancellationToken cancellation)
    {
        var root = Path.GetFullPath(directory);
        CheckDirectories(root);

        var sources = new List<Source>();
        var directories = new Stack<DirectoryInfo>();
        directories.Push(new DirectoryInfo(root));
        var inspected = 0;
        var skipped = 0;
        while (directories.Count > 0)
        {
            var current = directories.Pop();
            cancellation.ThrowIfCancellationRequested();
            try
            {
                CheckDirectories(current.FullName, root);
                foreach (var item in current.EnumerateFileSystemInfos())
                {
                    cancellation.ThrowIfCancellationRequested();
                    if (++inspected > ScanLimit)
                    {
                        return Finish(limited: true);
                    }
                    if ((item.Attributes & Excluded) != 0) continue;
                    if (item is DirectoryInfo child)
                    {
                        if (!child.Name.StartsWith(".", StringComparison.Ordinal)
                            && !child.Name.Equals("node_modules", StringComparison.OrdinalIgnoreCase)
                            && !(current.FullName.Equals(root, StringComparison.OrdinalIgnoreCase)
                                && child.Name.Equals(OutputDirectory, StringComparison.OrdinalIgnoreCase)))
                        {
                            directories.Push(child);
                        }
                        continue;
                    }
                    if (item is FileInfo file && (Extensions.Contains(file.Extension) || OfficeTextReader.Supports(file.Extension))
                        && !file.Name.StartsWith(OutputPrefix, StringComparison.OrdinalIgnoreCase)
                        && !file.Name.StartsWith("~$", StringComparison.Ordinal))
                    {
                        if (file.Length == 0 || file.Length > FileSizeLimit(file.Extension))
                        {
                            skipped++;
                            continue;
                        }
                        if (sources.Count == ListLimit) return Finish(limited: true);
                        var relative = file.FullName.Substring(RootPrefix(root).Length);
                        sources.Add(new Source(relative, (int)file.Length));
                    }
                }
            }
            catch (Exception error) when (!string.Equals(current.FullName, root, StringComparison.OrdinalIgnoreCase)
                && (error is IOException || error is UnauthorizedAccessException))
            {
                // One inaccessible subdirectory need not prevent processing the rest of the workspace.
            }
        }
        return Finish(limited: false);

        TaskWorkspace Finish(bool limited)
        {
            sources.Sort((a, b) => StringComparer.OrdinalIgnoreCase.Compare(a.name, b.name));
            return new TaskWorkspace(root, sources, limited, skipped);
        }
    }

    internal sealed class SourceText
    {
        public string content { get; }
        public int bytes { get; }

        internal SourceText(string content, int bytes)
        {
            this.content = content;
            this.bytes = bytes;
        }
    }

    internal sealed class Document
    {
        public string name { get; }
        public string path { get; }

        internal Document(string name, string path)
        {
            this.name = name;
            this.path = path;
        }
    }

    internal SourceText Read(string name)
    {
        if (!names.Contains(name)) throw new ReadFailure(ReadError.missing);

        var path = Path.Combine(Root, name);
        try
        {
            CheckDirectories(Path.GetDirectoryName(path)!, Root);
            if ((File.GetAttributes(path) & (Excluded | FileAttributes.Directory)) != 0)
            {
                throw new ReadFailure(ReadError.access);
            }
            using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var extension = Path.GetExtension(name);
            if (file.Length > FileSizeLimit(extension)) throw new ReadFailure(ReadError.tooLarge);
            var content = OfficeTextReader.Supports(extension) ? OfficeTextReader.Read(file, extension) : ReadText(file);
            if (content.IndexOf('\0') >= 0) throw new ReadFailure(ReadError.encoding);
            if (string.IsNullOrWhiteSpace(content)) throw new ReadFailure(ReadError.empty);
            var bytes = Utf8.GetByteCount(content);
            if (bytes > InputLimit) throw new ReadFailure(ReadError.tooLarge);
            return new SourceText(content, bytes);
        }
        catch (DecoderFallbackException)
        {
            throw new ReadFailure(ReadError.encoding);
        }
        catch (Exception error) when (error is InvalidDataException || error is System.Xml.XmlException || error is FormatException)
        {
            throw new ReadFailure(ReadError.format);
        }
        catch (Exception error) when (error is FileNotFoundException || error is DirectoryNotFoundException)
        {
            throw new ReadFailure(ReadError.missing);
        }
        catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
        {
            throw new ReadFailure(ReadError.access);
        }
    }

    internal static Document Save(string root, Guid taskId, string title, string content)
    {
        if (string.IsNullOrWhiteSpace(content) || content.Length > 256 * 1024)
        {
            throw new ArgumentException("Invalid Markdown document.");
        }
        CheckDirectories(root);
        var folder = Path.Combine(root, OutputDirectory);
        Directory.CreateDirectory(folder);
        CheckDirectories(folder, root);

        var name = OutputName(title, taskId);
        var path = Path.Combine(folder, name);
        var temp = Path.Combine(folder, Guid.NewGuid().ToString("N") + ".tmp");
        var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        try
        {
            using (stream)
            using (var writer = new StreamWriter(stream, Utf8)) writer.Write(content);
            try
            {
                File.Move(temp, path);
            }
            catch (IOException) when (File.Exists(path))
            {
                // A retry can follow a successful move whose reply never reached the window.
                ValidateOutput(path, root);
                if (new FileInfo(path).Length != Utf8.GetByteCount(content) || File.ReadAllText(path, Utf8) != content)
                    throw new ReadFailure(ReadError.outputChanged);
            }
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
        return new Document(name, path);
    }

    private static string OutputName(string title, Guid taskId)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var clean = new string(title.Trim().Take(64).Select(ch => invalid.Contains(ch) || ch == '.' || char.IsControl(ch) ? ' ' : ch).ToArray()).Trim();
        if (clean.Length > 0 && char.IsHighSurrogate(clean[clean.Length - 1])) clean = clean.Substring(0, clean.Length - 1);
        if (clean.Length == 0) clean = "文档";
        return clean + " - " + taskId.ToString("N").Substring(0, 12) + ".md";
    }

    internal static string ResolveOutput(string root, Guid taskId, string title)
    {
        var path = Path.Combine(root, OutputDirectory, OutputName(title, taskId));
        ValidateOutput(path, root);
        return path;
    }

    private static void ValidateOutput(string path, string root)
    {
        CheckDirectories(Path.GetDirectoryName(path)!, root);
        if ((File.GetAttributes(path) & (Excluded | FileAttributes.Directory)) != 0)
        {
            throw new IOException("The generated document is no longer available.");
        }
    }

    internal static void Open(string path, bool showInFolder)
    {
        if (showInFolder)
        {
            var explorer = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
            Process.Start(new ProcessStartInfo(explorer, "/select,\"" + path + "\"") { UseShellExecute = false })?.Dispose();
            return;
        }
        try
        {
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true })?.Dispose();
        }
        catch (Win32Exception)
        {
            var notepad = Path.Combine(Environment.SystemDirectory, "notepad.exe");
            Process.Start(new ProcessStartInfo(notepad, "\"" + path + "\"") { UseShellExecute = false })?.Dispose();
        }
    }

    private static int FileSizeLimit(string extension) => OfficeTextReader.Supports(extension) ? OfficeFileLimit : InputLimit;

    private static string ReadText(FileStream file)
    {
        using var reader = new BinaryReader(file, Utf8, leaveOpen: true);
        var bytes = reader.ReadBytes((int)file.Length);
        if (bytes.Length >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf)
        {
            return Utf8.GetString(bytes, 3, bytes.Length - 3);
        }
        if (bytes.Length >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe)
        {
            return new UnicodeEncoding(false, true, true).GetString(bytes, 2, bytes.Length - 2);
        }
        if (bytes.Length >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff)
        {
            return new UnicodeEncoding(true, true, true).GetString(bytes, 2, bytes.Length - 2);
        }
        try
        {
            return Utf8.GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            // Common encoding of CSV and plain-text exports from Chinese Windows programs.
            return Encoding.GetEncoding(54936, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback).GetString(bytes);
        }
    }

    private static string RootPrefix(string path) => path.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;

    private static void CheckDirectories(string path, string? workspaceRoot = null)
    {
        if (workspaceRoot is not null && !string.Equals(path, workspaceRoot, StringComparison.OrdinalIgnoreCase)
            && !path.StartsWith(RootPrefix(workspaceRoot), StringComparison.OrdinalIgnoreCase))
        {
            throw new IOException("The path is outside the workspace.");
        }
        for (var directory = new DirectoryInfo(path); directory is not null; directory = directory.Parent)
        {
            var attributes = File.GetAttributes(directory.FullName);
            if ((attributes & FileAttributes.Directory) == 0 || (attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new IOException("Linked or unavailable workspace directory.");
            }
        }
    }
}
