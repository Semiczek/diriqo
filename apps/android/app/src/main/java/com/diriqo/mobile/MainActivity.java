package com.diriqo.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.DocumentsContract;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.URLUtil;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

public final class MainActivity extends Activity {
    static final int PICK_FILE = 410, CAPTURE_PHOTO = 411, SAVE_DOCUMENT = 412;
    private static final int INK = Color.rgb(26, 31, 49), MUTED = Color.rgb(102, 112, 133);
    private WebView web;
    private FrameLayout content;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private ScrollView welcomePanel;
    private TextView status;
    private int brand;
    private String lastPage = UrlPolicy.ORIGIN + BuildConfig.ENTRY_PATH;
    private boolean failed;
    private volatile int sessionGeneration;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private DownloadRequest pendingDownload;
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private volatile HttpsURLConnection activeDownload;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        brand = getColor(R.color.brand);
        cleanOldCaptures();
        createShell();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::goBack);
        if (!getPreferences(MODE_PRIVATE).getBoolean("welcomeSeen", false)) showWelcome();
        else openHome();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setFontFeatureSettings("kern");
        if (bold) view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return view;
    }
    private GradientDrawable surface(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(dp(radius)); return drawable;
    }
    private Button button(String label, Runnable action, boolean primary) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false); button.setTextSize(15);
        button.setTextColor(primary ? Color.WHITE : INK); button.setMinHeight(dp(48));
        button.setBackground(surface(primary ? brand : Color.rgb(240, 242, 249), 14));
        button.setPadding(dp(16), dp(8), dp(16), dp(8)); button.setOnClickListener(v -> action.run()); return button;
    }
    private void gap(LinearLayout layout, int height) { View v = new View(this); layout.addView(v, new LinearLayout.LayoutParams(1, dp(height))); }

    private void createShell() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout header = new LinearLayout(this); header.setGravity(Gravity.CENTER_VERTICAL); header.setPadding(dp(18), dp(9), dp(12), dp(9));
        ImageView mark = new ImageView(this); mark.setImageResource(R.drawable.diriqo_logo); mark.setScaleType(ImageView.ScaleType.CENTER_CROP); mark.setBackground(surface(brand, 13)); mark.setClipToOutline(true); mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        header.addView(mark, new LinearLayout.LayoutParams(dp(40), dp(40)));
        LinearLayout titles = new LinearLayout(this); titles.setOrientation(LinearLayout.VERTICAL); titles.setPadding(dp(12), 0, 0, 0);
        titles.addView(text(getString(R.string.app_name), 17, INK, true));
        status = text(BuildConfig.IS_MANAGER ? "Firma pod kontrolou" : "Váš pracovní den", 11, MUTED, false); titles.addView(status);
        header.addView(titles, new LinearLayout.LayoutParams(0, -2, 1));
        Button more = button("•••", this::showMenu, false); more.setContentDescription("Další možnosti"); header.addView(more, new LinearLayout.LayoutParams(dp(52), dp(48)));
        root.addView(header);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal); progress.setProgressTintList(android.content.res.ColorStateList.valueOf(brand));
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(3))); progress.setVisibility(View.INVISIBLE);
        content = new FrameLayout(this); content.setBackgroundColor(Color.rgb(247, 248, 252)); root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        createWebView();
        LinearLayout bottom = new LinearLayout(this); bottom.setPadding(dp(10), dp(8), dp(10), dp(8));
        addNav(bottom, "Zpět", this::goBack);
        addNav(bottom, BuildConfig.IS_MANAGER ? "Přehled" : "Moje práce", this::openHome);
        addNav(bottom, "Diriqent", () -> navigate("/diriqent"));
        root.addView(bottom);
        setContentView(root);
    }
    private void addNav(LinearLayout bar, String label, Runnable action) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1); params.setMargins(dp(3), 0, dp(3), 0); bar.addView(button(label, action, false), params);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        web = new WebView(this); web.setBackgroundColor(Color.rgb(247, 248, 252));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); // Required by Diriqo. No native JavaScript bridge is registered.
        s.setDomStorageEnabled(true); s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false); s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); s.setSafeBrowsingEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false); s.setSupportMultipleWindows(true);
        s.setMediaPlaybackRequiresUserGesture(true); s.setGeolocationEnabled(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setUserAgentString(s.getUserAgentString() + " DiriqoAndroid/" + BuildConfig.VERSION_NAME + (BuildConfig.IS_MANAGER ? " Manager" : " Employee"));
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String url = request.getUrl().toString();
                if (UrlPolicy.isInternal(url)) return false;
                if (request.hasGesture() && UrlPolicy.canOpenExternal(url)) external(url);
                else if (UrlPolicy.isStorageDownload(url)) showMessage("Soubor otevřete přes nabídku pro stažení dokumentu.");
                else showMessage("Tento odkaz nelze v aplikaci otevřít.");
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                failed = false; progress.setVisibility(View.VISIBLE);
                if (!UrlPolicy.isInternal(url)) { view.stopLoading(); showError("Tuto stránku nelze otevřít", "Aplikace se připojuje pouze k Diriqu."); return; }
                lastPage = url; status.setText("Připojuji k Diriqu…");
                if (errorPanel != null) errorPanel.setVisibility(View.GONE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush(); progress.setVisibility(View.INVISIBLE);
                if (failed || !UrlPolicy.isInternal(url)) return;
                status.setText(UrlPolicy.isAuthenticationPath(url) ? "Přihlášení do Diriqa" : "app.diriqo.com");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("Diriqo teď není dostupné", "Zkontrolujte připojení k internetu. Rozpracovanou akci po návratu nejdřív zkontrolujte; aplikace ji sama neopakuje.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse error) {
                if (request.isForMainFrame() && error.getStatusCode() >= 500) showError("Diriqo se dočasně neozývá", "Zkuste stránku načíst znovu za chvíli. Uloženou práci ověřte před opakováním akce.");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); showError("Spojení není bezpečné", "Zkontrolujte datum a čas telefonu nebo zkuste jinou síť.");
            }
            @Override public void onReceivedHttpAuthRequest(WebView view, android.webkit.HttpAuthHandler handler, String host, String realm) { handler.cancel(); }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                content.removeView(view); view.destroy(); createWebView(); showError("Obrazovka se zavřela", "Otevřete přehled znovu a ověřte poslední provedenou akci."); return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                cancelFileChoice();
                if (!UrlPolicy.isInternal(view.getUrl())) { callback.onReceiveValue(null); return true; }
                fileCallback = callback;
                boolean images = false;
                for (String accept : params.getAcceptTypes()) if (accept.startsWith("image/") || accept.contains(".jpg") || accept.contains(".png")) images = true;
                if (images) new AlertDialog.Builder(MainActivity.this).setTitle("Přidat podklad")
                    .setItems(new String[]{"Vyfotit", "Vybrat z telefonu"}, (dialog, which) -> { if (which == 0) takePhoto(); else chooseDocument(params); })
                    .setOnCancelListener(dialog -> cancelFileChoice()).show();
                else chooseDocument(params);
                return true;
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, android.os.Message result) {
                if (!userGesture || !UrlPolicy.isInternal(view.getUrl())) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    private boolean handled;
                    private boolean handle(String url) {
                        if (handled) return true;
                        handled = true;
                        if (UrlPolicy.isInternal(url)) web.loadUrl(url);
                        else if (UrlPolicy.canOpenExternal(url)) external(url);
                        popup.destroy(); return true;
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return handle(r.getUrl().toString()); }
                    @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) { v.stopLoading(); handle(url); }
                });
                ((WebView.WebViewTransport) result.obj).setWebView(popup); result.sendToTarget(); return true;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (!UrlPolicy.isInternal(url) && !UrlPolicy.isStorageDownload(url)) { showMessage("Tento soubor nelze bezpečně stáhnout."); return; }
            if (length > DownloadPolicy.MAX_BYTES) { showMessage("Největší podporovaný soubor má 25 MB."); return; }
            if (pendingDownload != null) { showMessage("Nejdřív dokončete předchozí stahování."); return; }
            String name = DownloadPolicy.safeName(URLUtil.guessFileName(url, disposition, mime));
            pendingDownload = new DownloadRequest(url, userAgent, CookieManager.getInstance().getCookie(UrlPolicy.ORIGIN), DownloadPolicy.safeMime(mime));
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(pendingDownload.mime).putExtra(Intent.EXTRA_TITLE, name);
            try { startActivityForResult(intent, SAVE_DOCUMENT); } catch (ActivityNotFoundException e) { pendingDownload = null; showMessage("Telefon nemá aplikaci pro ukládání dokumentů."); }
        });
        content.addView(web, 0, new FrameLayout.LayoutParams(-1, -1));
    }

    private void showWelcome() {
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        welcomePanel = scroll;
        LinearLayout welcome = new LinearLayout(this); welcome.setOrientation(LinearLayout.VERTICAL); welcome.setPadding(dp(26), dp(34), dp(26), dp(30));
        welcome.addView(text(BuildConfig.IS_MANAGER ? "PŘEHLED PRO VEDENÍ" : "PRO VÁŠ PRACOVNÍ DEN", 12, brand, true)); gap(welcome, 14);
        welcome.addView(text(BuildConfig.IS_MANAGER ? "Méně hledání.\nVíce přehledu." : "Práce přehledně.\nPřímo v kapse.", 34, INK, true)); gap(welcome, 16);
        TextView description = text(BuildConfig.IS_MANAGER ? "Zakázky, tým a firemní moduly na jednom místě." : "Vaše zakázky, směny a pracovní fotky na jednom místě.", 17, MUTED, false); description.setLineSpacing(dp(4), 1); welcome.addView(description); gap(welcome, 30);
        welcomeCard(welcome, "01", BuildConfig.IS_MANAGER ? "Přehled firmy" : "Moje práce", BuildConfig.IS_MANAGER ? "Zakázky a rozpracované směny v aktuální firmě." : "Přiřazené zakázky a jednoduchý start a konec směny.");
        welcomeCard(welcome, "02", BuildConfig.IS_MANAGER ? "Moduly podle potřeby" : "Fotka a hotovo", BuildConfig.IS_MANAGER ? "Vozidla, sklad a nabídky podle vašich oprávnění." : "Vyfoťte průběh práce a přidejte podklad k zakázce.");
        welcomeCard(welcome, "03", "Stejný účet Diriqo", "Firma, oprávnění a licence se ověřují při práci."); gap(welcome, 24);
        welcome.addView(button("Přihlásit se a začít", () -> {
            getPreferences(MODE_PRIVATE).edit().putBoolean("welcomeSeen", true).apply(); content.removeView(scroll); openHome();
        }, true), new LinearLayout.LayoutParams(-1, dp(54))); gap(welcome, 16);
        TextView note = text("Testovací verze • Vyžaduje internet\nPřihlaste se svým stávajícím účtem Diriqo.", 12, MUTED, false); note.setGravity(Gravity.CENTER); welcome.addView(note);
        scroll.addView(welcome); content.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
    }
    private void welcomeCard(LinearLayout parent, String number, String title, String body) {
        LinearLayout card = new LinearLayout(this); card.setPadding(dp(18), dp(18), dp(18), dp(18)); card.setBackground(surface(Color.WHITE, 18));
        TextView badge = text(number, 14, brand, true); badge.setPadding(0, dp(3), dp(14), 0); card.addView(badge);
        LinearLayout lines = new LinearLayout(this); lines.setOrientation(LinearLayout.VERTICAL); lines.addView(text(title, 17, INK, true)); gap(lines, 6);
        TextView detail = text(body, 14, MUTED, false); detail.setLineSpacing(dp(3), 1); lines.addView(detail); card.addView(lines, new LinearLayout.LayoutParams(0, -2, 1));
        parent.addView(card, new LinearLayout.LayoutParams(-1, -2)); gap(parent, 10);
    }
    private void showError(String title, String body) {
        failed = true; progress.setVisibility(View.INVISIBLE); status.setText("Připojení není dostupné");
        if (errorPanel != null) content.removeView(errorPanel);
        errorPanel = new LinearLayout(this); errorPanel.setOrientation(LinearLayout.VERTICAL); errorPanel.setGravity(Gravity.CENTER); errorPanel.setPadding(dp(28), dp(30), dp(28), dp(30)); errorPanel.setBackgroundColor(Color.rgb(247,248,252));
        TextView heading = text(title, 25, INK, true); heading.setGravity(Gravity.CENTER); errorPanel.addView(heading); gap(errorPanel, 16);
        TextView detail = text(body, 16, MUTED, false); detail.setGravity(Gravity.CENTER); detail.setLineSpacing(dp(4), 1); errorPanel.addView(detail); gap(errorPanel, 26);
        errorPanel.addView(button("Načíst přehled", this::openHome, true));
        content.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
    }
    private void showMenu() {
        String[] choices = {"Úvodní přehled", "Obnovit stránku", "Otevřít v prohlížeči", "Odhlásit z tohoto telefonu", "O aplikaci"};
        new AlertDialog.Builder(this).setTitle(getString(R.string.app_name)).setItems(choices, (dialog, which) -> {
            switch (which) {
                case 0 -> openHome();
                case 1 -> { if (UrlPolicy.isAuthenticationPath(lastPage)) openHome(); else if (UrlPolicy.isInternal(lastPage)) web.loadUrl(lastPage); }
                case 2 -> external(UrlPolicy.ORIGIN + BuildConfig.ENTRY_PATH);
                case 3 -> new AlertDialog.Builder(this).setTitle("Odhlásit se?").setMessage("Přihlášení a místní data Diriqa v této aplikaci budou odstraněna. Ostatní zařízení zůstanou přihlášená.")
                    .setNegativeButton("Zůstat", null).setPositiveButton("Odhlásit", (d, w) -> { cancelFileChoice(); clearLocalSession(); }).show();
                case 4 -> new AlertDialog.Builder(this).setTitle(getString(R.string.app_name)).setMessage("Verze " + BuildConfig.VERSION_NAME + "\n\nOnline aplikace připojená k app.diriqo.com. Dostupnost agend určuje vaše firma, role a licence. Bez připojení nelze zapisovat práci.\n\nPodklady vybíráte sami; aplikace nečte galerii ani polohu na pozadí.").setPositiveButton("Rozumím", null).show();
            }
        }).show();
    }
    private void clearLocalSession() {
        sessionGeneration++;
        if (activeDownload != null) activeDownload.disconnect();
        pendingDownload = null; web.stopLoading(); web.clearHistory(); web.clearCache(true); web.clearFormData();
        content.removeView(web); web.destroy(); createWebView(); WebStorage.getInstance().deleteAllData();
        CookieManager.getInstance().removeAllCookies(done -> { CookieManager.getInstance().flush(); openHome(); });
    }
    void openHome() { navigate(BuildConfig.ENTRY_PATH); }
    private void navigate(String path) {
        String url = UrlPolicy.ORIGIN + path;
        if (!UrlPolicy.isInternal(url)) return;
        if (welcomePanel != null) { content.removeView(welcomePanel); welcomePanel = null; getPreferences(MODE_PRIVATE).edit().putBoolean("welcomeSeen", true).apply(); }
        if (errorPanel != null) errorPanel.setVisibility(View.GONE);
        web.loadUrl(url);
    }
    private void external(String value) {
        if (!UrlPolicy.canOpenExternal(value) && !UrlPolicy.isInternal(value)) return;
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(value)); intent.addCategory(Intent.CATEGORY_BROWSABLE);
        try { startActivity(intent); } catch (ActivityNotFoundException e) { showMessage("Pro tento odkaz není v telefonu vhodná aplikace."); }
    }
    private void goBack() {
        if (errorPanel != null && errorPanel.getVisibility() == View.VISIBLE) { openHome(); return; }
        if (web.canGoBack()) web.goBack(); else finish();
    }
    // Android 13+ uses the OnBackInvokedCallback registered in onCreate.
    // This override is the fallback only for supported Android 8–12 devices.
    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { goBack(); }
    private void showMessage(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }

    private void chooseDocument(WebChromeClient.FileChooserParams params) {
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        java.util.ArrayList<String> types = new java.util.ArrayList<>();
        for (String accept : params.getAcceptTypes()) if (accept.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.*+-]+")) types.add(accept);
        if (!types.isEmpty()) { pick.setType(types.get(0)); if (types.size() > 1) { pick.setType("*/*"); pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0])); } }
        pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        try { startActivityForResult(pick, PICK_FILE); } catch (ActivityNotFoundException e) { cancelFileChoice(); showMessage("V telefonu chybí výběr souborů."); }
    }
    private void takePhoto() {
        try {
            File folder = new File(getCacheDir(), "capture"); if (!folder.isDirectory() && !folder.mkdirs()) throw new java.io.IOException();
            File file = new File(folder, UUID.randomUUID() + ".jpg"); if (!file.createNewFile()) throw new java.io.IOException();
            cameraUri = Uri.parse("content://" + getPackageName() + ".capture/" + file.getName());
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            camera.setClipData(ClipData.newRawUri("Pracovní fotka", cameraUri));
            startActivityForResult(camera, CAPTURE_PHOTO);
        } catch (Exception e) { cancelFileChoice(); showMessage("Fotoaparát není dostupný. Vyberte soubor z telefonu."); }
    }
    private void cancelFileChoice() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (cameraUri != null) { revokeUriPermission(cameraUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); cameraUri = null; }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == SAVE_DOCUMENT) {
            DownloadRequest download = pendingDownload;
            if (result == RESULT_OK && data != null && data.getData() != null && download != null) saveDocument(download, data.getData());
            else pendingDownload = null;
            return;
        }
        if (request != PICK_FILE && request != CAPTURE_PHOTO) return;
        if (fileCallback == null) { cancelFileChoice(); return; }
        java.util.ArrayList<Uri> files = new java.util.ArrayList<>();
        if (result == RESULT_OK) {
            if (request == CAPTURE_PHOTO && cameraUri != null) files.add(cameraUri);
            else if (data != null) {
                if (data.getClipData() != null) for (int i = 0; i < Math.min(data.getClipData().getItemCount(), 20); i++) files.add(data.getClipData().getItemAt(i).getUri());
                else if (data.getData() != null) files.add(data.getData());
            }
        }
        files.removeIf(uri -> uri == null || !"content".equals(uri.getScheme()) || (uri.getAuthority() != null && uri.getAuthority().equals(getPackageName() + ".capture") && !uri.equals(cameraUri)));
        ValueCallback<Uri[]> callback = fileCallback; fileCallback = null;
        callback.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0]));
        if (cameraUri != null) { revokeUriPermission(cameraUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); cameraUri = null; }
    }
    private void cleanOldCaptures() {
        File[] files = new File(getCacheDir(), "capture").listFiles();
        if (files != null) for (File file : files) if (file.isFile() && file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
    }

    private record DownloadRequest(String url, String agent, String cookie, String mime) {}
    private void saveDocument(DownloadRequest request, Uri target) {
        final int generation = sessionGeneration;
        showMessage("Ukládám dokument…");
        downloads.execute(() -> {
            boolean saved = false;
            try {
                String current = request.url;
                for (int redirect = 0; redirect < 4; redirect++) {
                    if (generation != sessionGeneration || Thread.currentThread().isInterrupted()) throw new java.io.IOException();
                    if (!UrlPolicy.isInternal(current) && !UrlPolicy.isStorageDownload(current)) throw new java.io.IOException();
                    HttpsURLConnection connection = (HttpsURLConnection) new URL(current).openConnection(); activeDownload = connection;
                    connection.setConnectTimeout(15000); connection.setReadTimeout(30000); connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("User-Agent", request.agent);
                    if (UrlPolicy.isInternal(current) && request.cookie != null) connection.setRequestProperty("Cookie", request.cookie);
                    int status = connection.getResponseCode();
                    if (status >= 300 && status < 400) {
                        String location = connection.getHeaderField("Location");
                        if (location == null) throw new java.io.IOException();
                        String next = new URL(new URL(current), location).toString(); connection.disconnect();
                        if (!DownloadPolicy.canRedirect(current, next) || UrlPolicy.isAuthenticationPath(next)) throw new java.io.IOException();
                        current = next; continue;
                    }
                    if (status != 200 || connection.getContentLengthLong() > DownloadPolicy.MAX_BYTES) throw new java.io.IOException();
                    try (InputStream input = connection.getInputStream(); OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                        if (output == null) throw new java.io.IOException();
                        byte[] buffer = new byte[16384]; long size = 0; int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (generation != sessionGeneration || Thread.currentThread().isInterrupted()) throw new java.io.IOException();
                            size += count; if (size > DownloadPolicy.MAX_BYTES) throw new java.io.IOException(); output.write(buffer, 0, count);
                        }
                    }
                    connection.disconnect(); saved = true; break;
                }
            } catch (Exception ignored) { /* No URLs, cookies or document content in logs. */ }
            finally { if (activeDownload != null) activeDownload.disconnect(); activeDownload = null; }
            if (!saved) try { DocumentsContract.deleteDocument(getContentResolver(), target); } catch (Exception ignored) { }
            boolean success = saved;
            runOnUiThread(() -> { pendingDownload = null; if (!isFinishing() && !isDestroyed()) showMessage(success ? "Dokument byl uložen." : "Dokument se nepodařilo uložit. Zkontrolujte připojení a přihlášení."); });
        });
    }
    @Override protected void onPause() { CookieManager.getInstance().flush(); web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        cancelFileChoice(); if (activeDownload != null) activeDownload.disconnect(); downloads.shutdownNow();
        web.stopLoading(); content.removeView(web); web.destroy(); super.onDestroy();
    }
}
