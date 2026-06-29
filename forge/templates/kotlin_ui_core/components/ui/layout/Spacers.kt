package {{ package_name }}.ui.core.components.ui.layout

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
fun SmallSpacer() {
    Spacer(modifier = Modifier.height(8.dp))
}

@Composable
fun MediumSpacer() {
    Spacer(modifier = Modifier.height(16.dp))
}

@Composable
fun LargeSpacer() {
    Spacer(modifier = Modifier.height(24.dp))
}

@Composable
fun ExtraLargeSpacer() {
    Spacer(modifier = Modifier.height(32.dp))
}

@Composable
fun CustomSpacer(height: Dp) {
    Spacer(modifier = Modifier.height(height))
}