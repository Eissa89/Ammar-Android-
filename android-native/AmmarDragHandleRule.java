package com.example.ammarcompanion;

import android.content.res.Resources;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;

import com.hjq.window.draggable.MovingWindowDraggableRule;

/**
 * Keeps normal WebView interaction intact while reserving the small top grip
 * for native EasyWindow dragging. Touches outside the grip are delegated to
 * EasyWindow's normal child-view dispatch, so the companion remains clickable.
 */
public final class AmmarDragHandleRule extends MovingWindowDraggableRule {

    private static final float DRAG_HANDLE_HEIGHT_DP = 38f;

    @Override
    public View findNeedConsumeTouchView(
        @NonNull ViewGroup viewGroup,
        @NonNull MotionEvent event
    ) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
            int[] location = new int[2];
            viewGroup.getLocationOnScreen(location);
            float localY = event.getRawY() - location[1];
            float handleHeightPx = DRAG_HANDLE_HEIGHT_DP
                * Resources.getSystem().getDisplayMetrics().density;

            if (localY >= 0 && localY <= handleHeightPx) {
                return null;
            }
        }
        return super.findNeedConsumeTouchView(viewGroup, event);
    }
}
