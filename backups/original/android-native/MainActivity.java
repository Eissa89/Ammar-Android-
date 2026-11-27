package com.example.ammarcompanion;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the local native plugin before Capacitor initializes its bridge.
        registerPlugin(AmmarEasyWindowPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
