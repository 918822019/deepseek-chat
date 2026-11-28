using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class TaskFolderPicker
{
    private static readonly Guid FileOpenDialog = new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7");
    private const int Cancelled = unchecked((int)0x800704C7);
    private const uint PickFolders = 0x20;
    private const uint ForceFileSystem = 0x40;
    private const uint PathMustExist = 0x800;
    private const uint DontAddToRecent = 0x02000000;
    private const uint FileSystemPath = 0x80058000;

    internal static string? Select(IWin32Window owner, string title)
    {
        var dialogType = Type.GetTypeFromCLSID(FileOpenDialog, throwOnError: true)!;
        var dialog = (IFileDialog)Activator.CreateInstance(dialogType)!;
        try
        {
            dialog.SetTitle(title);
            dialog.GetOptions(out var options);
            dialog.SetOptions(options | PickFolders | ForceFileSystem | PathMustExist | DontAddToRecent);

            var result = dialog.Show(owner.Handle);
            if (result == Cancelled) return null;
            Marshal.ThrowExceptionForHR(result);
            dialog.GetResult(out var item);
            try
            {
                item.GetDisplayName(FileSystemPath, out var path);
                return path;
            }
            finally
            {
                Marshal.ReleaseComObject(item);
            }
        }
        finally
        {
            Marshal.ReleaseComObject(dialog);
        }
    }

    // COM vtable methods are declared in SDK order through the last slot we use.
    [ComImport]
    [Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint count, IntPtr specs);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetResult(out IShellItem item);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    }
}
