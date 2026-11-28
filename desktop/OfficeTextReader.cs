using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

internal static class OfficeTextReader
{
    internal static bool Supports(string extension) =>
        extension.Equals(".docx", StringComparison.OrdinalIgnoreCase)
        || extension.Equals(".xlsx", StringComparison.OrdinalIgnoreCase);

    internal static string Read(Stream file, string extension)
    {
        using var archive = new ZipArchive(file, ZipArchiveMode.Read, leaveOpen: true);
        var package = new Package(archive);
        var output = new StringBuilder();
        if (extension.Equals(".docx", StringComparison.OrdinalIgnoreCase))
        {
            var document = package.Xml("word/document.xml");
            var w = document.Name.Namespace;
            var body = document.Element(w + "body") ?? throw new InvalidDataException();
            foreach (var paragraph in body.Descendants(w + "p"))
            {
                // Preserve the order of paragraphs and the alignment of adjacent table cells.
                foreach (var element in paragraph.Descendants())
                {
                    if (element.Name == w + "t") output.Append(element.Value);
                    else if (element.Name == w + "tab") output.Append('\t');
                    else if (element.Name == w + "br" || element.Name == w + "cr") output.Append('\n');
                }
                var cell = paragraph.Parent;
                var nextCell = cell?.Name == w + "tc" && !paragraph.ElementsAfterSelf().Any()
                    && cell.ElementsAfterSelf(w + "tc").Any();
                output.Append(nextCell ? '\t' : '\n');
                CheckSize(output);
            }
        }
        else
        {
            ReadWorkbook(package, output);
        }
        return output.ToString().Trim();
    }

    private static void ReadWorkbook(Package package, StringBuilder output)
    {
        var workbook = package.Xml("xl/workbook.xml");
        var ns = workbook.Name.Namespace;
        var rels = package.Xml("xl/_rels/workbook.xml.rels").Elements()
            .Where(r => (string?)r.Attribute("TargetMode") != "External")
            .ToDictionary(r => r.Attribute("Id")?.Value ?? throw new InvalidDataException(), StringComparer.Ordinal);
        string? Part(string kind) => rels.Values
            .Where(r => ((string?)r.Attribute("Type"))?.EndsWith("/" + kind, StringComparison.Ordinal) == true)
            .Select(RelationshipPath).FirstOrDefault();

        var stringsPath = Part("sharedStrings");
        var strings = stringsPath is null ? Array.Empty<string>() :
            package.Xml(stringsPath).Elements(ns + "si").Select(RichText).ToArray();
        var stylesPath = Part("styles");
        var dates = stylesPath is null ? Array.Empty<bool>() : DateStyles(package.Xml(stylesPath));
        var epoch = (string?)workbook.Element(ns + "workbookPr")?.Attribute("date1904");
        foreach (var sheet in workbook.Element(ns + "sheets")?.Elements(ns + "sheet") ?? Enumerable.Empty<XElement>())
        {
            var id = sheet.Attributes().FirstOrDefault(a => a.Name.LocalName == "id")?.Value;
            if (id is null || !rels.TryGetValue(id, out var relationship)
                || relationship.Attribute("Type")?.Value.EndsWith("/worksheet", StringComparison.Ordinal) != true) continue;
            var worksheet = package.Xml(RelationshipPath(relationship));
            var rows = worksheet.Element(ns + "sheetData")?.Elements(ns + "row");
            if (rows is null) continue;
            var headingWritten = false;
            foreach (var row in rows)
            {
                var values = new List<string>();
                foreach (var cell in row.Elements(ns + "c"))
                {
                    var type = (string?)cell.Attribute("t");
                    var value = (string?)cell.Element(ns + "v");
                    if (type == "s")
                    {
                        if (!int.TryParse(value, out var index) || index < 0 || index >= strings.Length)
                            throw new InvalidDataException();
                        value = strings[index];
                    }
                    else if (type == "inlineStr") value = RichText(cell);
                    else if (type == "b" && value is not null) value = value == "1" ? "TRUE" : "FALSE";
                    else if ((type is null || type == "n") && int.TryParse((string?)cell.Attribute("s"), out var style)
                        && style >= 0 && style < dates.Length && dates[style]
                        && double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var serial)
                        && serial >= 0 && serial < 2957000)
                    {
                        var offset = epoch == "1" || epoch == "true" ? 1462 : serial < 60 ? 1 : 0;
                        var date = DateTime.FromOADate(serial + offset);
                        value = date.ToString(serial < 1 && offset != 1462 ? "HH:mm:ss"
                            : date.TimeOfDay == TimeSpan.Zero ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                    }
                    if (string.IsNullOrEmpty(value) && cell.Element(ns + "f") is XElement formula && formula.Value.Length > 0)
                        value = "=" + formula.Value;
                    if (!string.IsNullOrWhiteSpace(value))
                        values.Add((string?)cell.Attribute("r") + "=" + value);
                }
                if (values.Count == 0) continue;
                if (!headingWritten)
                {
                    output.Append("## ").AppendLine((string?)sheet.Attribute("name"));
                    headingWritten = true;
                }
                output.AppendLine(string.Join("\t", values));
                CheckSize(output);
            }
        }
    }

    private static string RichText(XElement element)
    {
        var ns = element.Name.Namespace;
        return string.Concat(element.Descendants(ns + "t").Where(t => !t.Ancestors(ns + "rPh").Any()).Select(t => t.Value));
    }

    private static bool[] DateStyles(XElement styles)
    {
        var ns = styles.Name.Namespace;
        var formats = (styles.Element(ns + "numFmts")?.Elements(ns + "numFmt") ?? Enumerable.Empty<XElement>())
            .ToDictionary(f => (int?)f.Attribute("numFmtId") ?? throw new InvalidDataException(),
                f => f.Attribute("formatCode")?.Value ?? throw new InvalidDataException());
        return (styles.Element(ns + "cellXfs")?.Elements(ns + "xf") ?? Enumerable.Empty<XElement>()).Select(style =>
        {
            var id = (int?)style.Attribute("numFmtId") ?? 0;
            if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58))
                return true;
            if (!formats.TryGetValue(id, out var format)) return false;
            var tokens = Regex.Replace(format, "\"[^\"]*\"|\\\\.|\\[[^\\]]*\\]", "");
            return Regex.IsMatch(tokens, "[ydhHsS]", RegexOptions.IgnoreCase);
        }).ToArray();
    }

    private static string RelationshipPath(XElement relation)
    {
        var target = (string?)relation.Attribute("Target") ?? throw new InvalidDataException();
        var uri = new Uri(new Uri("https://package.local/xl/workbook.xml"), target);
        if (uri.Host != "package.local" || uri.Scheme != "https") throw new InvalidDataException();
        return Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
    }

    private static void CheckSize(StringBuilder output)
    {
        if (output.Length > TaskWorkspace.InputLimit) throw new TaskWorkspace.ReadFailure(TaskWorkspace.ReadError.tooLarge);
    }

    private sealed class Package
    {
        private readonly ZipArchive archive;
        private long remaining = 48 * 1024 * 1024;

        internal Package(ZipArchive archive)
        {
            if (archive.Entries.Count > 8192) throw new InvalidDataException();
            this.archive = archive;
        }

        internal XElement Xml(string name)
        {
            var entry = archive.GetEntry(name) ?? throw new InvalidDataException();
            remaining -= entry.Length;
            if (entry.Length > 16 * 1024 * 1024 || remaining < 0)
                throw new TaskWorkspace.ReadFailure(TaskWorkspace.ReadError.tooLarge);
            using var stream = entry.Open();
            using var reader = XmlReader.Create(stream, new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 16 * 1024 * 1024,
            });
            return XElement.Load(reader);
        }
    }
}
