package com.punchin.employee;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    private static final String ALIAS = "com.punchin.employee.session.v1";
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("punchin_secure_session", Context.MODE_PRIVATE);
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    @PluginMethod
    public void set(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.length() < 30 || token.length() > 200) { call.reject("Invalid session"); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            String encrypted = Base64.encodeToString(cipher.doFinal(token.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
            if (!preferences().edit().putString("token", encrypted).putString("iv", iv).commit()) throw new Exception("Storage unavailable");
            call.resolve();
        } catch (Exception error) { call.reject("Session could not be securely stored"); }
    }
    @PluginMethod
    public void get(PluginCall call) {
        String encrypted = preferences().getString("token", null);
        String iv = preferences().getString("iv", null);
        if (encrypted == null || iv == null) { call.resolve(new JSObject().put("token", org.json.JSONObject.NULL)); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            String value = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("token", value));
        } catch (Exception error) {
            preferences().edit().clear().commit();
            call.reject("Session storage is unavailable. Sign in again.");
        }
    }
    @PluginMethod
    public void remove(PluginCall call) {
        if (!preferences().edit().clear().commit()) { call.reject("Session could not be removed"); return; }
        call.resolve();
    }
}
