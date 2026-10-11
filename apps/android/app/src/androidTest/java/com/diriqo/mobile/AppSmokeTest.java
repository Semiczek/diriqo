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
    @Test public void selectedCaptureCanBeReadByHtmlWithoutGeneralContentAccess() throws Exception {
        Instrumentation test = InstrumentationRegistry.getInstrumentation();
        Context context = test.getTargetContext();
        MainActivity activity = (MainActivity) test.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        AtomicReference<WebView> browser = new AtomicReference<>();
        test.runOnMainSync(() -> {
            activity.openHome();
            browser.set(findWebView(activity.getWindow().getDecorView()));
        });
        awaitSignIn(test, browser.get());
        test.runOnMainSync(() -> browser.get().evaluateJavascript("document.body.innerHTML=\"<input id='f' style='position:fixed;top:20px;left:20px;width:200px;height:60px' type='file' accept='image/jpeg'><p id='result'>waiting</p>\"; document.getElementById('f').onchange=async()=>{try{document.getElementById('result').textContent=await document.getElementById('f').files[0].text()}catch(e){document.getElementById('result').textContent='READ_FAILED'}}", null));
        awaitPaint(test, browser.get());
        java.lang.reflect.Field callback = MainActivity.class.getDeclaredField("fileCallback"); callback.setAccessible(true);
        java.lang.reflect.Field capture = MainActivity.class.getDeclaredField("cameraUri"); capture.setAccessible(true);
        int[] position = new int[2];
        test.runOnMainSync(() -> browser.get().getLocationOnScreen(position));
        float density = context.getResources().getDisplayMetrics().density;
        long time = android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent down = android.view.MotionEvent.obtain(time, time, android.view.MotionEvent.ACTION_DOWN, position[0] + 70 * density, position[1] + 45 * density, 0);
        android.view.MotionEvent up = android.view.MotionEvent.obtain(time, time + 80, android.view.MotionEvent.ACTION_UP, position[0] + 70 * density, position[1] + 45 * density, 0);
        test.sendPointerSync(down); test.sendPointerSync(up); down.recycle(); up.recycle();
        for (int attempt = 0; attempt < 30 && callback.get(activity) == null; attempt++) Thread.sleep(100);
        assertNotNull("HTML selection must reach native file chooser", callback.get(activity));
        File folder = new File(context.getCacheDir(), "capture"); assertTrue(folder.isDirectory() || folder.mkdirs());
        File file = new File(folder, java.util.UUID.randomUUID() + ".jpg");
        try (FileOutputStream out = new FileOutputStream(file)) { out.write("synthetic-only".getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        capture.set(activity, android.net.Uri.parse("content://" + context.getPackageName() + ".capture/" + file.getName()));
        test.runOnMainSync(() -> activity.onActivityResult(MainActivity.CAPTURE_PHOTO, android.app.Activity.RESULT_OK, null));
        test.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK); // Close the still-open choice dialog.
        String value = "";
        for (int attempt = 0; attempt < 40; attempt++) {
            CountDownLatch latch = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>("");
            test.runOnMainSync(() -> browser.get().evaluateJavascript("document.getElementById('result')?.textContent", text -> { result.set(text); latch.countDown(); }));
            assertTrue(latch.await(2, TimeUnit.SECONDS)); value = result.get();
            if (value.contains("synthetic-only") || value.contains("READ_FAILED")) break;
            Thread.sleep(100);
        }
        assertTrue("Selected URI should be readable only through file chooser: " + value, value.contains("synthetic-only"));
        test.runOnMainSync(activity::finish);
    }
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
        });
        awaitSignIn(test, browser.get());
        screenshot(test, context, "login");
        test.runOnMainSync(() -> {
            browser.get().getSettings().setBlockNetworkLoads(true);
            browser.get().loadUrl(UrlPolicy.ORIGIN + "/sign-in?android-test=offline");
        });
        long deadline = System.currentTimeMillis() + 10000;
        AtomicReference<Boolean> offline = new AtomicReference<>(false);
        while (System.currentTimeMillis() < deadline && !offline.get()) {
            test.runOnMainSync(() -> offline.set(findText(activity.getWindow().getDecorView(), "Diriqo teď není dostupné") != null));
            Thread.sleep(200);
        }
        assertTrue("Offline load must show a clear recoverable state", offline.get());
        screenshot(test, context, "offline");
        test.runOnMainSync(() -> { browser.get().getSettings().setBlockNetworkLoads(false); activity.finish(); });
    }
    private static void awaitSignIn(Instrumentation test, WebView browser) throws Exception {
        long deadline = System.currentTimeMillis() + 45000;
        String body = "";
        while (System.currentTimeMillis() < deadline) {
            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<String> text = new AtomicReference<>("");
            test.runOnMainSync(() -> browser.evaluateJavascript("location.pathname + ' | ' + document.readyState + ' | ' + (document.body ? document.body.innerText : '')", value -> { text.set(value); latch.countDown(); }));
            assertTrue(latch.await(3, TimeUnit.SECONDS));
            body = text.get();
            if (body.contains("/sign-in | complete") && isSignIn(body)) break;
            Thread.sleep(300);
        }
        assertTrue("Real deployed sign-in form should load, without credentials. Public page: " + body, body.contains("/sign-in | complete") && isSignIn(body));
        awaitPaint(test, browser);
    }
    private static void awaitPaint(Instrumentation test, WebView browser) throws Exception {
        CountDownLatch painted = new CountDownLatch(1);
        test.runOnMainSync(() -> browser.postVisualStateCallback(1, new WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) { painted.countDown(); }
        }));
        assertTrue("Web content should paint", painted.await(5, TimeUnit.SECONDS));
        test.waitForIdleSync();
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
