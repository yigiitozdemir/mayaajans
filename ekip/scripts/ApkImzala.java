// Android APK'yı imzalar ve doğrular (apksig). Kullanım:
//   java -cp apksig.jar ApkImzala.java <imzasız.apk> <imzalı.apk> <anahtar.jks> <parola-dosyası>
import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;

public class ApkImzala {
  public static void main(String[] a) throws Exception {
    char[] pw = new String(Files.readAllBytes(Paths.get(a[3]))).trim().toCharArray();
    KeyStore ks = KeyStore.getInstance("PKCS12");
    try (InputStream in = new FileInputStream(a[2])) { ks.load(in, pw); }
    String alias = ks.aliases().nextElement();
    PrivateKey key = (PrivateKey) ks.getKey(alias, pw);
    X509Certificate cert = (X509Certificate) ks.getCertificate(alias);
    ApkSigner.SignerConfig sc = new ApkSigner.SignerConfig.Builder("MAYA", key, Collections.singletonList(cert)).build();
    new ApkSigner.Builder(Collections.singletonList(sc))
        .setInputApk(new File(a[0])).setOutputApk(new File(a[1]))
        .setV1SigningEnabled(false).setV2SigningEnabled(true) // minSdk 24: v2 imzası yeterli
        .build().sign();
    ApkVerifier.Result r = new ApkVerifier.Builder(new File(a[1])).build().verify();
    System.out.println("doğrulandı=" + r.isVerified() + " v1=" + r.isVerifiedUsingV1Scheme() + " v2=" + r.isVerifiedUsingV2Scheme());
    for (ApkVerifier.IssueWithParams e : r.getErrors()) System.out.println("HATA " + e);
    if (!r.isVerified()) System.exit(1);
  }
}
