package dev.chatdemo.client;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "ChatFiles")
public class ChatFilesPlugin extends Plugin {
    private File getArchive(PluginCall call) {
        String cacheName = call.getString("cacheName", "");
        if (!cacheName.matches("chat-demo-history-[0-9a-f-]{36}\\.zip")) {
            call.reject("Invalid history archive");
            return null;
        }
        return new File(getContext().getCacheDir(), cacheName);
    }

    @PluginMethod
    public void appendHistoryChunk(PluginCall call) {
        File archive = getArchive(call);
        if (archive == null) {
            return;
        }
        try (FileOutputStream output = new FileOutputStream(archive, true)) {
            output.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
        } catch (IOException | IllegalArgumentException error) {
            call.reject("Could not write the history archive", error);
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void discardHistory(PluginCall call) {
        File archive = getArchive(call);
        if (archive == null) {
            return;
        }
        if (archive.exists() && !archive.delete()) {
            call.reject("Could not remove the temporary history archive");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void saveHistory(PluginCall call) {
        File archive = getArchive(call);
        if (archive == null) {
            return;
        }
        if (!archive.isFile()) {
            call.reject("History archive is missing");
            return;
        }
        String suggestedName = call.getString("name", "chat-history.zip");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/zip")
            .putExtra(Intent.EXTRA_TITLE, suggestedName);
        startActivityForResult(call, intent, "saveHistoryResult");
    }

    @ActivityCallback
    private void saveHistoryResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        File archive = getArchive(call);
        if (archive == null) {
            return;
        }
        Intent data = result.getData();
        Uri destination = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || destination == null) {
            call.resolve();
            return;
        }
        execute(() -> {
            try (
                FileInputStream input = new FileInputStream(archive);
                OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")
            ) {
                if (output == null) {
                    throw new IOException("Could not open the selected file");
                }
                byte[] buffer = new byte[64 * 1024];
                int length;
                while ((length = input.read(buffer)) != -1) {
                    output.write(buffer, 0, length);
                }
            } catch (IOException | SecurityException error) {
                call.reject("Could not save the history archive", error);
                return;
            }
            call.resolve();
        });
    }
}
