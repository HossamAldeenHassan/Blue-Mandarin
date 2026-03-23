@echo off
title Blue Mandarin - GitHub Sync ❄️
color 0B

echo ===========================================
echo   BLUE MANDARIN - AUTO SYNC TO GITHUB
echo ===========================================
echo.

:: التأكد من أننا في الفرع الصحيح
git branch -M main

:: تجهيز جميع التعديلات
echo [1/3] Adding changes...
git add .

:: طلب رسالة التحديث من المستخدم
set /p msg="Enter update message (e.g. Added Vocab): "
if "%msg%"=="" set msg="Weekly Update - Blue Mandarin"

:: تنفيذ الـ Commit
echo [2/3] Committing changes...
git commit -m "%msg%"

:: الرفع إلى GitHub
echo [3/3] Pushing to GitHub...
git push origin main

echo.
echo ===========================================
echo    SUCCESS! Your code is now on GitHub 💙
echo ===========================================
pause