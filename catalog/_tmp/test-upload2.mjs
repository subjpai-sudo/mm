import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadString, getDownloadURL } from "firebase/storage";
for (const bucket of ["catalog-58ec8.firebasestorage.app","catalog-58ec8.appspot.com","gs://catalog-58ec8.firebasestorage.app"]) {
  try {
    const app = initializeApp({ apiKey:"AIzaSyCamvdagAyxxmWVO3kOhRKO01tNyi4XCa4", projectId:"catalog-58ec8", storageBucket:bucket, appId:"1:1055844775598:web:4a7d14594fc5498c2a1f3f"}, "x"+Math.random());
    const s = getStorage(app);
    const r = ref(s, "products/_t.txt");
    await uploadString(r, "hi");
    const u = await getDownloadURL(r);
    console.log("OK", bucket, u);
  } catch (e) {
    console.log("FAIL", bucket, e.code, e.customData?.serverResponse?.slice?.(0,200) || e.message);
  }
}
process.exit(0);
