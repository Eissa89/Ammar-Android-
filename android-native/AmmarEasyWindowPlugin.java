package com.example.ammarcompanion;

import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.hjq.window.EasyWindow;
import com.example.ammarcompanion.AmmarDragHandleRule;

import org.json.JSONObject;

/**
 * Capacitor plugin that hosts Ammar inside a global EasyWindow overlay.
 *
 * <p>Verified against EasyWindow 15.8 (https://github.com/getActivity/EasyWindow):
 * {@code EasyWindow.with(Application)} creates a global window that requires
 * {@code SYSTEM_ALERT_WINDOW}; {@code show()} reports failures through
 * {@code isShowing()} instead of throwing; {@code setWindowParams()} schedules the
 * layout update itself.
 */
@CapacitorPlugin(name = "AmmarOverlay")
public class AmmarEasyWindowPlugin extends Plugin {

    private static final String TAG = "AmmarOverlay";

    /** Capacitor copies www/ into android/app/src/main/assets/public. */
    private static final String OVERLAY_ASSET_URL = "file:///android_asset/public/index.html?mode=android";
    private static final String ASSET_URL_PREFIX = "file:///android_asset/";
    private static final String JS_BRIDGE_NAME = "AndroidBridge";

    private static final int WINDOW_WIDTH_DP = 184;
    private static final int WINDOW_HEIGHT_DP = 244;
    private static final int START_X_DP = 12;
    private static final int START_Y_DP = 140;
    /** Upper bound for one JS-driven movement step, in dp. */
    private static final float MAX_MOVE_STEP_DP = 240f;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private EasyWindow<?> easyWindow;
    private WebView overlayWebView;
    private String pendingSpeech;

    @Override
    protected void handleOnDestroy() {
        mainHandler.post(this::destroyOverlayWindow);
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------------
    // Permission
    // ------------------------------------------------------------------

    private boolean hasOverlayPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        Context context = getContext();
        return context != null && Settings.canDrawOverlays(context);
    }

    @PluginMethod
    public void checkOverlayPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasOverlayPermission());
        result.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        if (hasOverlayPermission()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            result.put("settingsOpened", false);
            call.resolve(result);
            return;
        }
        if (getActivity() == null || getContext() == null) {
            call.reject("OVERLAY_PERMISSION_UNAVAILABLE: no attached activity");
            return;
        }
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())
            );
            startActivityForResult(call, intent, "overlayPermissionResult");
        } catch (Exception error) {
            Log.w(TAG, "cannot open overlay settings", error);
            call.reject("OVERLAY_SETTINGS_UNAVAILABLE: تعذر فتح إعدادات صلاحية الظهور فوق التطبيقات", error);
        }
    }

    @ActivityCallback
    private void overlayPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject response = new JSObject();
        response.put("granted", hasOverlayPermission());
        response.put("settingsOpened", true);
        call.resolve(response);
    }

    // ------------------------------------------------------------------
    // Overlay window
    // ------------------------------------------------------------------

    @PluginMethod
    public void showAmmar(PluginCall call) {
        if (!hasOverlayPermission()) {
            call.reject("OVERLAY_PERMISSION_DENIED: يجب منح صلاحية الظهور فوق التطبيقات أولاً");
            return;
        }
        final String speech = call.getString("text");
        mainHandler.post(() -> {
            try {
                if (easyWindow != null && easyWindow.isShowing()) {
                    speak(speech);
                    call.resolve(windowState());
                    return;
                }
                if (easyWindow == null) {
                    createOverlayWindow();
                }
                if (easyWindow == null) {
                    call.reject("OVERLAY_WINDOW_UNAVAILABLE: تعذر إنشاء نافذة Ammar العائمة");
                    return;
                }
                easyWindow.show();
                // EasyWindow.show() swallows WindowManager failures, so isShowing() is the only
                // reliable signal that the window really reached the screen.
                if (!easyWindow.isShowing()) {
                    destroyOverlayWindow();
                    call.reject("OVERLAY_WINDOW_FAILED: رفض النظام إضافة النافذة العائمة");
                    return;
                }
                speak(speech);
                call.resolve(windowState());
            } catch (Exception error) {
                Log.e(TAG, "showAmmar failed", error);
                destroyOverlayWindow();
                call.reject("OVERLAY_WINDOW_ERROR: فشل إنشاء نافذة Ammar العائمة", error);
            }
        });
    }

    @PluginMethod
    public void hideAmmar(PluginCall call) {
        mainHandler.post(() -> {
            destroyOverlayWindow();
            JSObject result = new JSObject();
            result.put("showing", false);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void moveBy(PluginCall call) {
        Double rawDx = call.getDouble("dx");
        Double rawDy = call.getDouble("dy");
        final float dx = clampStep(rawDx == null ? 0f : rawDx.floatValue());
        final float dy = clampStep(rawDy == null ? 0f : rawDy.floatValue());
        mainHandler.post(() -> {
            boolean moved = moveWindowBy(dx, dy);
            JSObject result = windowState();
            result.put("moved", moved);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void onAmmarClicked(PluginCall call) {
        mainHandler.post(() -> {
            boolean showing = easyWindow != null && easyWindow.isShowing();
            if (showing) {
                evaluateOverlayJs("window.AmmarOverlay && window.AmmarOverlay.jump && window.AmmarOverlay.jump();");
                try {
                    JSObject data = new JSObject();
                    data.put("source", "capacitor");
                    notifyListeners("ammarClicked", data);
                } catch (Exception error) {
                    Log.d(TAG, "no listener attached for ammarClicked", error);
                }
            }
            JSObject result = new JSObject();
            result.put("showing", showing);
            call.resolve(result);
        });
    }

    // ------------------------------------------------------------------
    // Window internals
    // ------------------------------------------------------------------

    private void createOverlayWindow() {
        Context context = getContext();
        if (context == null) {
            return;
        }
        Context appContext = context.getApplicationContext();
        if (!(appContext instanceof Application)) {
            appContext = context;
        }

        WebView webView = new WebView(appContext);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.addJavascriptInterface(new OverlayJavascriptBridge(), JS_BRIDGE_NAME);
        webView.setWebViewClient(new OverlayWebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d(TAG, "overlay console: " + message.message());
                return true;
            }
        });
        webView.loadUrl(OVERLAY_ASSET_URL);

        int width = dpToPx(WINDOW_WIDTH_DP);
        int height = dpToPx(WINDOW_HEIGHT_DP);
        int[] screen = screenSizePx();
        int startX = clamp(dpToPx(START_X_DP), 0, Math.max(0, screen[0] - width));
        int startY = clamp(dpToPx(START_Y_DP), 0, Math.max(0, screen[1] - height));

        overlayWebView = webView;
        easyWindow = EasyWindow.with((Application) appContext)
            .setContentView(webView)
            .setWindowSize(width, height)
            .setWindowLocation(Gravity.TOP | Gravity.LEFT, startX, startY)
            .setWindowDraggableRule(new AmmarDragHandleRule());
    }

    private void destroyOverlayWindow() {
        pendingSpeech = null;
        EasyWindow<?> window = easyWindow;
        easyWindow = null;
        if (window != null) {
            try {
                window.cancel();
                window.recycle();
            } catch (Exception error) {
                Log.w(TAG, "failed to recycle overlay window", error);
            }
        }
        WebView webView = overlayWebView;
        overlayWebView = null;
        if (webView != null) {
            try {
                webView.stopLoading();
                webView.removeJavascriptInterface(JS_BRIDGE_NAME);
                webView.setWebViewClient(new WebViewClient());
                webView.destroy();
            } catch (Exception error) {
                Log.w(TAG, "failed to destroy overlay WebView", error);
            }
        }
    }

    private boolean moveWindowBy(float dxDp, float dyDp) {
        EasyWindow<?> window = easyWindow;
        if (window == null || !window.isShowing()) {
            return false;
        }
        try {
            WindowManager.LayoutParams params = window.getWindowParams();
            int[] screen = screenSizePx();
            int viewWidth = window.getWindowViewWidth();
            int viewHeight = window.getWindowViewHeight();
            if (viewWidth <= 0) {
                viewWidth = params.width > 0 ? params.width : dpToPx(WINDOW_WIDTH_DP);
            }
            if (viewHeight <= 0) {
                viewHeight = params.height > 0 ? params.height : dpToPx(WINDOW_HEIGHT_DP);
            }
            int maxX = Math.max(0, screen[0] - viewWidth);
            int maxY = Math.max(0, screen[1] - viewHeight);
            int targetX = clamp(params.x + dpToPx(dxDp), 0, maxX);
            int targetY = clamp(params.y + dpToPx(dyDp), 0, maxY);
            boolean changed = targetX != params.x || targetY != params.y;

            params.gravity = Gravity.TOP | Gravity.LEFT;
            params.x = targetX;
            params.y = targetY;
            window.setWindowParams(params);
            return changed;
        } catch (Exception error) {
            Log.w(TAG, "moveWindowBy failed", error);
            return false;
        }
    }

    private JSObject windowState() {
        JSObject state = new JSObject();
        EasyWindow<?> window = easyWindow;
        boolean showing = window != null && window.isShowing();
        state.put("showing", showing);
        if (showing) {
            WindowManager.LayoutParams params = window.getWindowParams();
            state.put("x", params.x);
            state.put("y", params.y);
            state.put("width", window.getWindowViewWidth());
            state.put("height", window.getWindowViewHeight());
        }
        return state;
    }

    private void speak(String text) {
        if (text == null || text.isEmpty() || overlayWebView == null) {
            return;
        }
        pendingSpeech = text;
        evaluateOverlayJs("window.AmmarOverlay && window.AmmarOverlay.say && window.AmmarOverlay.say("
            + JSONObject.quote(text) + ");");
    }

    private void evaluateOverlayJs(String script) {
        WebView webView = overlayWebView;
        if (webView == null) {
            return;
        }
        try {
            webView.evaluateJavascript(script, null);
        } catch (Exception error) {
            Log.w(TAG, "evaluateJavascript failed", error);
        }
    }

    private int dpToPx(float dp) {
        Context context = getContext();
        if (context == null) {
            return Math.round(dp);
        }
        return Math.round(dp * context.getResources().getDisplayMetrics().density);
    }

    private int[] screenSizePx() {
        Context context = getContext();
        if (context != null) {
            WindowManager windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            if (windowManager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Rect bounds = windowManager.getMaximumWindowMetrics().getBounds();
                    return new int[]{bounds.width(), bounds.height()};
                }
                DisplayMetrics metrics = new DisplayMetrics();
                // getMaximumWindowMetrics() is unavailable below API 30; real metrics include the
                // area hidden by the system bars, which is what an overlay window can cover.
                //noinspection deprecation
                windowManager.getDefaultDisplay().getRealMetrics(metrics);
                return new int[]{metrics.widthPixels, metrics.heightPixels};
            }
            DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            return new int[]{metrics.widthPixels, metrics.heightPixels};
        }
        return new int[]{0, 0};
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static float clampStep(float value) {
        if (Float.isNaN(value) || Float.isInfinite(value)) {
            return 0f;
        }
        return Math.max(-MAX_MOVE_STEP_DP, Math.min(MAX_MOVE_STEP_DP, value));
    }

    /** Only the two commands the overlay page needs are exposed to JavaScript. */
    private final class OverlayJavascriptBridge {

        @JavascriptInterface
        public void moveBy(double dx, double dy) {
            final float stepX = clampStep((float) dx);
            final float stepY = clampStep((float) dy);
            mainHandler.post(() -> moveWindowBy(stepX, stepY));
        }

        @JavascriptInterface
        public void onAmmarClicked() {
            mainHandler.post(() -> {
                if (getBridge() == null) {
                    return;
                }
                try {
                    JSObject data = new JSObject();
                    data.put("source", "overlay");
                    notifyListeners("ammarClicked", data);
                } catch (Exception error) {
                    Log.d(TAG, "no listener attached for ammarClicked", error);
                }
            });
        }
    }

    private final class OverlayWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request == null ? null : request.getUrl();
            String target = url == null ? "" : url.toString();
            if (target.startsWith(ASSET_URL_PREFIX)) {
                return false;
            }
            Log.w(TAG, "blocked overlay navigation: " + target);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (pendingSpeech != null) {
                speak(pendingSpeech);
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            Log.e(TAG, "overlay WebView render process gone");
            mainHandler.post(AmmarEasyWindowPlugin.this::destroyOverlayWindow);
            return true;
        }
    }
}
