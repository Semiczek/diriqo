package com.diriqo.mobile;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

/** Run on a fresh dedicated test emulator; never seeds accounts or writes business records. */
@RunWith(AndroidJUnit4.class)
public final class AppSmokeTest {
    @Test public void installedAppWelcomeSecureLoginAndOfflineRecovery() throws Exception {
        Instrumentation test = InstrumentationRegistry.getInstrumentation();
        Context context = test.getTargetContext();
        assertEquals(BuildConfig.IS_MANAGER ? "com.diriqo.manager" : "com.diriqo.my", context.getPackageName());
        context.getSharedPreferences("com.diriqo.mobile.MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        MainActivity activity = (MainActivity) test.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        test.waitForIdleSync();
        AtomicReference<WebView> browser = new AtomicReference<>();
        test.runOnMainSync(() -> {
            browser.set(findWebView(activity.getWindow().getDecorView()));
            assertNotNull(browser.get());
            WebSettings settings = browser.get().getSettings();
            assertTrue(settings.getJavaScriptEnabled());
            assertFalse(settings.getAllowFileAccess());
            assertFalse(settings.getAllowContentAccess());
            assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, settings.getMixedContentMode());
            assertTrue(settings.getSafeBrowsingEnabled());
            assertNotNull(findText(activity.getWindow().getDecorView(), "Přihlásit se a začít"));
        });
        screenshot(test, context, "welcome");
        test.runOnMainSync(() -> {
            findText(activity.getWindow().getDecorView(), "Přihlásit se a začít").performClick();
            browser.get().loadUrl(UrlPolicy.ORIGIN + "/sign-in");
        });
        long deadline = System.currentTimeMillis() + 45000;
        String body = "";
        while (System.currentTimeMillis() < deadline) {
            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<String> text = new AtomicReference<>("");
            test.runOnMainSync(() -> browser.get().evaluateJavascript("document.body ? document.body.innerText : ''", value -> { text.set(value); latch.countDown(); }));
            assertTrue(latch.await(3, TimeUnit.SECONDS));
            body = text.get();
            if (isSignIn(body)) break;
            Thread.sleep(300);
        }
        screenshot(test, context, "login");
        assertTrue("Real deployed sign-in form should load, without credentials. Public page: " + body, isSignIn(body));
        test.runOnMainSync(() -> {
            browser.get().getSettings().setBlockNetworkLoads(true);
            browser.get().loadUrl(UrlPolicy.ORIGIN + "/sign-in?android-test=offline");
        });
        deadline = System.currentTimeMillis() + 10000;
        AtomicReference<Boolean> offline = new AtomicReference<>(false);
        while (System.currentTimeMillis() < deadline && !offline.get()) {
            test.runOnMainSync(() -> offline.set(findText(activity.getWindow().getDecorView(), "Diriqo teď není dostupné") != null));
            Thread.sleep(200);
        }
        assertTrue("Offline load must show a clear recoverable state", offline.get());
        screenshot(test, context, "offline");
        test.runOnMainSync(() -> { browser.get().getSettings().setBlockNetworkLoads(false); activity.finish(); });
    }
    private static boolean isSignIn(String body) { return (body.contains("Přihlášení") && body.contains("Heslo")) || (body.contains("Sign in") && body.contains("Password")); }
    private static TextView findText(View view, String label) {
        if (view instanceof TextView text && text.getText().toString().equals(label)) return text;
        if (view instanceof ViewGroup group) for (int i = 0; i < group.getChildCount(); i++) { TextView found = findText(group.getChildAt(i), label); if (found != null) return found; }
        return null;
    }
    private static WebView findWebView(View view) {
        if (view instanceof WebView web) return web;
        if (view instanceof ViewGroup group) for (int i = 0; i < group.getChildCount(); i++) { WebView found = findWebView(group.getChildAt(i)); if (found != null) return found; }
        return null;
    }
    private static void screenshot(Instrumentation test, Context context, String stage) throws Exception {
        test.waitForIdleSync();
        Bitmap bitmap = test.getUiAutomation().takeScreenshot(); assertNotNull(bitmap);
        File folder = new File(context.getExternalFilesDir(null), "test-evidence"); assertTrue(folder.isDirectory() || folder.mkdirs());
        try (FileOutputStream out = new FileOutputStream(new File(folder, stage + ".png"))) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); }
        bitmap.recycle();
    }
}
