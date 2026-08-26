# Menu Organizer

จัดเรียง ซ่อน/แสดง และย้ายบล็อกตั้งค่าของแต่ละ extension ในหน้า Extensions
(drawer ไอคอนลูกบาศก์ 🧊 fa-cubes) ได้เองด้วยการลากวาง ข้ามคอลัมน์ซ้าย/ขวาได้

## การใช้งาน

1. เปิด drawer **Extensions** (ไอคอน fa-cubes มุมบน)
2. หา drawer **Menu Organizer** ในคอลัมน์ซ้าย แล้วกด **เปิดตัวจัดเรียงเมนู**
3. จะเห็นสองคอลัมน์ (ซ้าย/ขวา) ตรงกับ layout จริงของหน้า Extensions
4. ลากด้วยไอคอน ⠿ เพื่อจัดลำดับ หรือลากข้ามไปอีกคอลัมน์
5. กดรูปตา 👁 เพื่อซ่อน/แสดงแต่ละบล็อก
6. ทุกการเปลี่ยนแปลงถูกบันทึกอัตโนมัติ (ผ่าน extension settings)

## Version Manager (v1.3)

กด **Version Manager** ใน drawer ของ Menu Organizer เพื่อจัดการ third-party Git extensions ที่ติดตั้งอยู่:

- ดูเลข version จาก `manifest.json`, branch และ commit ปัจจุบัน
- ดูสถานะว่า branch ปัจจุบันมี update หรือไม่
- เลือก/switch ระหว่าง local และ remote branches (รวมถึง branch ที่ตั้งชื่อเป็น version)
- ใช้ปุ่ม ◀ / ▶ เพื่อเลื่อนไป branch ก่อนหน้า/ถัดไปในรายการ
- **Update** รายตัวจะ pull เฉพาะ branch ที่ extension ตัวนั้นใช้อยู่
- **Pin** เพื่อให้ **Update All** ข้าม extension ตัวนั้น
- **Check All** ตรวจสถานะและ branch ของทุกตัวใหม่

การ switch branch หรือ update ต้อง reload หน้า SillyTavern เพื่อให้ JavaScript/CSS ของ extension เวอร์ชันใหม่ถูกโหลดครบ

### ขอบเขต

- รองรับเฉพาะ extension ที่ `/api/extensions/discover` รายงานเป็น `local` หรือ `global` เท่านั้น; built-in/system extensions จะไม่ถูกแตะ
- ใช้ API มาตรฐาน `/version`, `/branches`, `/switch` และ `/update` ของ SillyTavern
- Git tags และการ checkout commit โดยตรงยังไม่รองรับ เพราะ SillyTavern ไม่มี generic endpoint สำหรับสองอย่างนี้
- การจัดการ global extension อาจต้องใช้บัญชี admin ตามสิทธิ์ที่ SillyTavern กำหนด

## จอคอม / จอมือถือ จำแยกกัน

- ตัวจัดเรียงตรวจจับขนาดจอ (`max-width: 768px`) แล้วเก็บลำดับ + การซ่อน **แยกโปรไฟล์**
  ระหว่างจอกว้าง (คอม) กับจอแคบ (มือถือ) อัตโนมัติ
- จัดบนคอมยังไง มือถือยังคงลำดับของมือถือเอง ไม่ทับกัน
- ป้ายด้านบนของตัวจัดเรียงจะบอกว่ากำลังตั้งค่าให้โปรไฟล์ไหนอยู่
- ถ้าหมุนจอหรือย่อ/ขยายหน้าต่างข้าม breakpoint ระบบจะสลับ layout ให้ตรงโปรไฟล์ทันที
- บนมือถือ: กดค้างที่ grip เล็กน้อยก่อนลาก (กันชนกับการเลื่อนหน้า) · เป้าแตะใหญ่ขึ้น

## มือถือ: เลย์เอาต์ + ข้อความไม่ล้น (v1.2.1)

- หน้า Extensions จริงบนมือถือสแตกเป็นแถวเดียว (พฤติกรรมของ SillyTavern เอง) — ตัวจัดเรียงก็สแตก “กลุ่มบน/ล่าง” ให้ตรง
- ชื่อเมนูยาว: ตัดด้วย ellipsis / คลัมป์ 2 บรรทัด + `min-width: 0` ตลอด flex chain กันทะลุขอบ
- หัว drawer ของ extension ใน `#extensions_settings` / `#extensions_settings2` ถูก clamp ไม่ล้นจอแคบ

## ประหยัดพลังงาน / เบาเครื่อง (v1.2)

- หยุด `MutationObserver` ทันทีเมื่อแท็บ/แอปถูกซ่อน (`visibilitychange`) แล้วค่อยกลับมาทำงานเมื่อเปิดกลับ
- debounce re-apply ยาวขึ้นตอน idle · เร็วขึ้นเฉพาะตอนเปิดตัวจัดเรียง
- รวม apply หลายครั้งเข้าเฟรมเดียวด้วย `requestAnimationFrame`
- เขียน DOM เฉพาะเมื่อตำแหน่ง/visibility เปลี่ยนจริง
- ทำลาย jQuery UI sortable เมื่อปิด popup แล้ว (ไม่ค้าง listener)
- เคารพ `prefers-reduced-motion`
- boot poll มีเพดาน — ไม่ `setInterval` ตลอดชีพ

## หมายเหตุ

- ลำดับที่ตั้งไว้จะคงอยู่แม้ extension อื่นจะเพิ่มบล็อกใหม่มาทีหลัง (บล็อกใหม่ไปต่อท้ายคอลัมน์เดิม)
- บล็อกที่ยังว่าง (extension ยังไม่ populate) จะไม่แสดงในตัวจัดเรียง จนกว่ามันจะมีเนื้อหา
- บล็อกของ Menu Organizer เองซ่อนไม่ได้ (แสดงไอคอนกุญแจ) กันไม่ให้เผลอซ่อนจนเปิดกลับไม่ได้
- กด **คืนค่าเริ่มต้น** เพื่อล้างลำดับและการซ่อน (เฉพาะโปรไฟล์ที่กำลังตั้งค่าอยู่)
