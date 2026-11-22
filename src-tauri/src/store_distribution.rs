#[cfg(windows)]
#[tauri::command]
pub fn is_microsoft_store_install() -> Result<bool, String> {
    use windows::ApplicationModel::{Package, PackageSignatureKind};
    use windows::Win32::System::WinRT::{
        RO_INIT_MULTITHREADED, RO_INIT_SINGLETHREADED, RoInitialize, RoUninitialize,
    };
    use windows_sys::Win32::{
        Foundation::{APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER},
        Storage::Packaging::Appx::GetCurrentPackageFullName,
    };

    let mut package_name_length = 0;
    let package_status =
        unsafe { GetCurrentPackageFullName(&mut package_name_length, std::ptr::null_mut()) };
    if package_status == APPMODEL_ERROR_NO_PACKAGE {
        return Ok(false);
    }
    if package_status != ERROR_INSUFFICIENT_BUFFER {
        return Err(format!(
            "Could not determine whether Noesis has package identity (Windows error {package_status})."
        ));
    }

    let apartment = unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.or_else(|error| {
        if error.code() == windows::core::HRESULT(0x80010106u32 as i32) {
            unsafe { RoInitialize(RO_INIT_SINGLETHREADED) }
        } else {
            Err(error)
        }
    });
    apartment
        .map_err(|error| format!("Could not initialize Windows package detection: {error}"))?;

    struct WinRtApartment;
    impl Drop for WinRtApartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }
    let _apartment = WinRtApartment;

    let package = Package::Current()
        .map_err(|error| format!("Could not inspect the current package signature: {error}"))?;
    let signature_kind = package
        .SignatureKind()
        .map_err(|error| format!("Could not inspect the current package signature: {error}"))?;
    Ok(signature_kind == PackageSignatureKind::Store)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn is_microsoft_store_install() -> Result<bool, String> {
    Ok(false)
}
