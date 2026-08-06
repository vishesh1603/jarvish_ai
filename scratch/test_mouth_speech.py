import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options

options = Options()
options.add_argument('--headless')
options.add_argument('--window-size=1280,800')

driver = webdriver.Chrome(options=options)
try:
    driver.get('http://127.0.0.1:5000/')
    time.sleep(1)

    driver.execute_script("document.getElementById('landing-page').style.display = 'none'; if (!avatarEnabled) toggleAvatarOutput();")
    time.sleep(1)

    driver.save_screenshot(r'C:\Users\DELL\.gemini\antigravity\scratch\jarvish_ai\static\mouth_normal_rest.png')

    input_box = driver.find_element(By.ID, 'user-input')
    input_box.send_keys('Tell me a sentence about space.\n')
    time.sleep(1.8)

    driver.save_screenshot(r'C:\Users\DELL\.gemini\antigravity\scratch\jarvish_ai\static\mouth_speaking_active.png')

    el = driver.find_element(By.ID, 'avatar-mouth')
    print('Mouth style during active speech:', el.get_attribute('style'))
finally:
    driver.quit()
