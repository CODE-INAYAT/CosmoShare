import fs from "fs/promises";
import { favicons } from "favicons";
import path from "path";

async function generate() {
  // We point it to the logo you are already using in your public folder
  const source = "./public/logo.svg";
  const dest = "./public/GeneratedIcons";

  try {
    const response = await favicons(source, {
      path: "/", // The route where the images will be served
      appName: "My Next.js App", // Replace with your app's name
      appShortName: "MyApp",
      appDescription: "My awesome Next.js app",
      background: "#ffffff", // Background color for icons (e.g., Windows tiles)
      theme_color: "#000000", // Theme color for Android task switcher
      icons: {
        android: true, // Create Android homescreen icon
        appleIcon: true, // Create Apple touch icons
        appleStartup: false,
        favicons: true, // Create regular favicon.ico & pngs
        windows: true, // Create Windows tile icons
        yandex: false,
      },
    });

    // Write all image files (e.g., .png, .ico) to the public folder
    for (const image of response.images) {
      await fs.writeFile(path.join(dest, image.name), image.contents);
      console.log(`✅ Created ${image.name}`);
    }

    // Write all config files (e.g., manifest.webmanifest, browserconfig.xml)
    for (const file of response.files) {
      await fs.writeFile(path.join(dest, file.name), file.contents);
      console.log(`✅ Created ${file.name}`);
    }

    console.log("🎉 All favicons successfully generated!");
  } catch (error) {
    console.error("❌ Error generating favicons:", error);
  }
}

generate();
