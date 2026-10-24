/** Suggestions are not diagnoses. Platform blocks do not identify their cause. */
export function meetingFailureGuidance(code) {
  switch(code) {
    case 'blocked':
      return {reasonConfirmed:false, retry:'after_conditions_change',
        message:'Google 拒絕加入；目前無法確定是登入、會議存取政策或其他限制。先核對這場的 bot.log／screens、專用帳號登入與主持人允許的加入方式；條件改變後再重試。'};
    case 'signin_required':
      return {reasonConfirmed:true, retry:'after_login',
        message:'頁面要求登入。執行 login，由使用者在專用 Chrome 完成登入與驗證；程式不處理密碼或驗證碼。'};
    case 'denied':
      return {reasonConfirmed:true, retry:'after_host_approval',
        message:'這次加入請求被拒絕。主持人同意並調整放行條件後才重試；不要反覆送出請求。'};
    case 'lobby_timeout':
      return {reasonConfirmed:true, retry:'after_host_available',
        message:'等待放行逾時。確認主持人能處理加入請求後再重試；這不代表已錄到會議。'};
    default: return null;
  }
}
