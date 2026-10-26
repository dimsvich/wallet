package com.zenlocal.app;

import android.app.Notification;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

public class BankNotificationListener extends NotificationListenerService {
    private static final String TAG = "ZenBankListener";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if ("ua.privatbank.ap24".equals(sbn.getPackageName())) {
            Notification notification = sbn.getNotification();
            Bundle extras = notification.extras;
            CharSequence textSeq = null;
            
            if (extras != null) {
                textSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
                if (textSeq == null) textSeq = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
                if (textSeq == null) textSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
            }
            if (textSeq == null && extras != null) {
                textSeq = extras.getCharSequence("android.text");
            }

            if (textSeq != null) {
                String text = textSeq.toString();
                long time = sbn.getPostTime();
                
                // 1. Записываем пуш в фоновую очередь (блокнот)
                try {
                    SharedPreferences prefs = getSharedPreferences("ZenPushQueue", Context.MODE_PRIVATE);
                    String queueStr = prefs.getString("queue", "[]");
                    JSONArray queue = new JSONArray(queueStr);
                    
                    JSONObject push = new JSONObject();
                    push.put("text", text);
                    push.put("time", time);
                    queue.put(push);
                    
                    prefs.edit().putString("queue", queue.toString()).apply();
                    Log.i(TAG, "Пуш сохранен в очередь");
                } catch (Exception e) {
                    Log.e(TAG, "Ошибка записи", e);
                }

                // 2. Отправляем в WebView (сработает, только если приложение открыто)
                Intent intent = new Intent("com.zenlocal.app.NEW_BANK_PUSH");
                intent.setPackage(getPackageName());
                intent.putExtra("text", text);
                intent.putExtra("time", time);
                sendBroadcast(intent);
            }
        }
    }
    
    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {}
}