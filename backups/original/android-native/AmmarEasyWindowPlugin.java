package com.example.ammarcompanion;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.hjq.window.EasyWindow;
import com.hjq.window.draggable.MovingWindowDraggableRule;

/** Native bridge between Ammar's web UI and the Android floating window. */
@CapacitorPlugin(name = "AmmarOverlay")
public class AmmarEasyWindowPlugin extends Plugin {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private EasyWindow<?> easyWindow;
    private WebView overlayWebView;

    private boolean hasOverlayPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
    }

    private int dp(float value) {
        return Math.round(value * getContext().getResources().getDisplayMetrics().density);
    }

    @PluginMethod
    public void checkOverlayPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasOverlayPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        if (hasOverlayPermission()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }

        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())
            );
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("granted", false);
            result.put("settingsOpened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("تعذر فتح إعدادات صلاحية الظهور فوق التطبيقات", error);
        }
    }

    @PluginMethod
    public void showAmmar(PluginCall call) {
        if (!hasOverlayPermission()) {
            call.reject("يجب منح صلاحية الظهور فوق التطبيقات أولاً");
            return;
        }

        mainHandler.post(() -> {
            try {
                if (easyWindow != null) {
                    if (!easyWindow.isShowing()) easyWindow.show();
                    call.resolve();
                    return;
                }

                Context context = getContext();
                overlayWebView = new WebView(context);
                overlayWebView.setBackgroundColor(Color.TRANSPARENT);
                overlayWebView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
                overlayWebView.setVerticalScrollBarEnabled(false);
                overlayWebView.setHorizontalScrollBarEnabled(false);
                overlayWebView.getSettings().setJavaScriptEnabled(true);
                overlayWebView.getSettings().setDomStorageEnabled(true);
                overlayWebView.getSettings().setAllowFileAccess(true);
                overlayWebView.setWebViewClient(new WebViewClient());

                overlayWebView.addJavascriptInterface(new Object() {
                    @JavascriptInterface
                    public void moveBy(float dx, float dy) {
                        mainHandler.post(() -> moveWindowBy(dx, dy));
                    }

                    @JavascriptInterface
                    public void onAmmarClicked() {
                        // The character's click animation and speech are handled in the WebView.
                    }
                }, "AndroidBridge");

                // Capacitor copies the configured www directory into android_asset/public.
                overlayWebView.loadUrl("file:///android_asset/public/index.html?mode=android");

                easyWindow = EasyWindow.with(getActivity().getApplication())
                    .setContentView(overlayWebView)
                    .setWindowSize(dp(220), dp(280))
                    .setWindowLocation(Gravity.TOP | Gravity.LEFT, dp(12), dp(140))
                    .setWindowDraggableRule(new MovingWindowDraggableRule());
                easyWindow.show();
                call.resolve();
            } catch (Exception error) {
                if (easyWindow != null) {
                    try { easyWindow.cancel(); } catch (Exception ignored) { }
                    easyWindow = null;
                }
                if (overlayWebView != null) {
                    try { overlayWebView.destroy(); } catch (Exception ignored) { }
                    overlayWebView = null;
                }
                call.reject("فشل إنشاء نافذة Ammar العائمة", error);
            }
        });
    }

    private void moveWindowBy(float dx, float dy) {
        if (easyWindow == null || !easyWindow.isShowing()) return;
        try {
            android.view.WindowManager.LayoutParams params = easyWindow.getWindowParams();
            DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
            int maxX = Math.max(0, metrics.widthPixels - easyWindow.getWindowViewWidth());
            int maxY = Math.max(0, metrics.heightPixels - easyWindow.getWindowViewHeight());
            params.x = Math.max(0, Math.min(maxX, params.x + dp(dx)));
            params.y = Math.max(0, Math.min(maxY, params.y + dp(dy)));
            easyWindow.setWindowParams(params);
        } catch (Exception ignored) {
            // Keep the companion responsive even if one position update is rejected by the OS.
        }
    }

    @PluginMethod
    public void hideAmmar(PluginCall call) {
        mainHandler.post(() -> {
            try {
                if (easyWindow != null) {
                    easyWindow.cancel();
                    easyWindow.recycle();
                    easyWindow = null;
                }
                if (overlayWebView != null) {
                    overlayWebView.stopLoading();
                    overlayWebView.removeJavascriptInterface("AndroidBridge");
                    overlayWebView.destroy();
                    overlayWebView = null;
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("تعذر إخفاء نافذة Ammar", error);
            }
        });
    }
}
